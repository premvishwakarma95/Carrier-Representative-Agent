# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Everly** — an AI voice agent built on Vapi that calls freight carriers on behalf of My Dray Rate (MDR), a drayage marketplace, to collect rate quotes on loads that haven't gotten enough email responses. This repo implements MDR's own "Carrier Bid Follow-Up" playbook (the two PDFs in the repo root) as a working system: a Vapi assistant + an orchestration service that decides who to call and when.

## Commands

```bash
npm install                # install deps
npm run typecheck          # tsc --noEmit — run this after any change, no test suite exists yet
npm run mock-mdr:dev        # starts the mock MDR API on $MOCK_MDR_PORT (default 4000), with reload — start this before dispatch:run/server:dev
npm run db:reset            # clears local operational data (CallAttempt/Escalation/Load); mock carrier/quote data resets via POST /mock/reset on that service instead
npm run assistant:create   # creates the Everly assistant in Vapi, or updates it if EVERLY_ASSISTANT_ID is set in .env
npm run dispatch:run       # runs a single orchestration cycle (eligibility scan → queue → dial) and exits
npm run server:dev         # starts the Express webhook receiver on $PORT (default 3000), with reload — also serves the MDR simulator UI at /simulator
```

To exercise the flow end-to-end without a real MDR system: start `mock-mdr:dev` + `server:dev`, open `http://localhost:3000/simulator`, submit a load — that fires `POST /webhooks/mdr/load-ready` and persists a local `Load` — then run `dispatch:run`.

There is no lint config and no automated test suite — verification so far has been done by running the actual scripts above against the live Vapi API and a real MongoDB Atlas cluster (not mocks). When changing orchestration logic, prefer writing a throwaway script (delete it after) that runs the real flow end-to-end over trusting typecheck alone — this repo has already caught real bugs (a timezone calculation error, a Mongoose `updateOne`-on-`createdAt` no-op) that typechecking did not.

## Required environment (`.env`, see `.env.example`)

`VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID`, `EVERLY_ASSISTANT_ID` (set after first `assistant:create` run), `MONGODB_URI`, `MDR_API_BASE_URL`/`MDR_API_KEY`/`MDR_ACCOUNT_ID` (point at the mock MDR service by default — see Architecture below). Twilio vars are intentionally omitted until that integration starts — see `requirements-tracker.md`.

**Dev-phase note**: the Vapi account and MongoDB cluster currently in use are the developer's own, not the client's, and `MDR_API_BASE_URL` points at the mock MDR service (`src/mock-mdr-api/`), not the client's real API — they haven't built it yet (see `Everly_MDR_API_Workload_Timeline_Estimation.pdf`). Before Phase 2 (real MDR integration) or any real carrier call, these need to swap to the client's Vapi account, the client's real MDR API, and a Twilio number with Trust Hub business verification — tracked in `requirements-tracker.md` and `twilio-setup.md`.

## Architecture

**As of the 2026-07-20 client call, MDR's integration is push-based, not pull-based.** MDR calls Everly's own webhook ~30 minutes after a carrier invitation email goes out, with the load, invited carriers (id + do-not-call), and account settings all in one payload — Everly no longer polls MDR to discover work. MDR confirmed only 4 read/write endpoints exist beyond that webhook; there is no load-discovery or bare carrier-lookup endpoint. See `src/mdr/api.ts`'s header comment for the confirmed API surface, and `requirements-tracker.md` for what's still open (notably: MDR promised a "refresh" API for settings/load changes mid-outreach, exact shape TBD — don't invent it).

Five layers. `src/mdr/`, `src/orchestration/`, and `src/server/` only talk to each other through the MDR API, the inbound webhook, and MongoDB — there's no direct function-call coupling between them:

1. **`src/assistant/`** — defines Everly herself. `prompt.ts` is the entire conversational script (converted near-verbatim from the playbook PDF's sections 1-18), with `{{variable}}` placeholders. `tools.ts` defines the 6 function-calling tools (`submit_quote`, `log_decline`, `schedule_callback`, `escalate_to_human`, `record_do_not_call`, `update_contact`) that turn conversation into structured data. `create.ts` pushes both to Vapi via `POST/PATCH /assistant`.

2. **`src/mdr/`** — the MDR API client (`client.ts` fetch wrapper + `api.ts` typed functions) for the 4 confirmed endpoints: quote-status, submit-quote, the combined per-(carrier,load) lookup, and do-not-call update. Today `MDR_API_BASE_URL` points at the mock service below; swapping to the client's real API later is a `MDR_API_BASE_URL`/`MDR_API_KEY` change only — no orchestration code should need to change.

3. **`src/mock-mdr-api/`** — a standalone Express service (own port, `npm run mock-mdr:dev`) implementing the 4 confirmed endpoints with in-memory fake data, plus a few extra routes (`GET /loads`, `GET /loads/:id`, bare `GET /carriers[/:id]`, account settings) that are **not** part of MDR's real API — kept only so `src/mdr-simulator-ui/` has data to read from while standing in for MDR's real system. See `src/mock-mdr-api/README.md`.

4. **`src/mdr-simulator-ui/`** — a single static page (served by `server.ts` at `/simulator`) that stands in for MDR's real system: fills out a load + invited carriers + settings and fires it at Everly's own webhook, the same way MDR will once it exists. Dev-only.

5. **`src/orchestration/`** — the decision-making pipeline, run via `dispatch:run` (intended to be invoked repeatedly/on a schedule, not long-running):
   `eligibility.ts` (reads locally-stored open `Load`s — no MDR polling) → `queueBuilder.ts` (which invited carriers are eligible, ranked, via the per-load carrier lookup) → `cadence.ts` + `callingWindow.ts` (is this specific attempt actually due right now, timezone-aware — attempt 1 uses the webhook's `receivedAt` directly, since the email-wait window already elapsed before MDR sent it) → `dispatcher.ts` (ties it together, re-verifies the load isn't closed and the carrier isn't do-not-call with fresh API calls immediately before dialing, creates the local `CallAttempt`, places the real Vapi call) → `stopConditions.ts` (re-checked after every single call, not just per batch — reads MDR's quote-status endpoint, and syncs the local `Load.status` to `"closed"` whenever it decides to stop, since MDR doesn't push closure updates to us).

6. **`src/server/`** — `mdrWebhook.ts` receives MDR's push (`POST /webhooks/mdr/load-ready`) and upserts the local `Load`. `webhookHandlers.ts` handles Vapi's two message types: `tool-calls` (mid-call — `submit_quote` and `record_do_not_call` write through to the MDR client; `log_decline`/`schedule_callback`/`escalate_to_human` stay local only, since MDR has no endpoints for them yet; `update_contact` is a no-op/log, since MDR has no endpoint for it at all) and `end-of-call-report` (post-call transcript/recording/summary, stored locally).

**Non-obvious design decision**: tool schemas in `tools.ts` deliberately do **not** include `loadId`/`carrierId` as LLM-supplied parameters — the model has no reliable way to know these IDs (only `carrierName` etc. are exposed as prompt variables). Instead, `webhookHandlers.ts` resolves the load/carrier/call-attempt context server-side by matching the webhook's `message.call.id` against the `CallAttempt.vapiCallId` that was recorded when the call was dispatched. If you add a new tool, follow this pattern rather than adding ID parameters back.

**Idempotency**: `CallAttempt` has a unique compound index on `(loadId, carrierId, attemptNumber)`. The dispatcher relies on this — if two dispatch runs race for the same attempt slot, the loser's insert throws a duplicate-key error (code 11000), which is caught and treated as "already claimed," not an error.

**Known gap, not yet fixed**: nothing currently caps how many carriers get dialed in one `dispatch:run` cycle relative to how many quotes are actually still needed — `queueBuilder.ts` returns the full eligible pool, and since `createOutboundCall()` returns before a call produces a quote, the stop-check right after a dial has nothing new to see yet. On a load with e.g. 100 invited carriers and a threshold of 20, this would currently dial through the entire eligible pool in one pass rather than stopping around the actual remaining gap.

**Data model** (`src/db/models/`): `CallAttempt` and `Escalation` are Everly's own operational/audit data, which has no MDR equivalent. `Load` is a local cache again (re-added 2026-07-20) — MDR's confirmed API has no `GET /loads`/`GET /loads/{id}`, so load details only ever arrive via the push webhook and have to be persisted or they're lost; see `src/db/models/Load.ts`'s header comment. `Carrier` is still **not** a local model — that stays API-only (`getCarrierForLoad`), since MDR does expose a live, re-fetchable endpoint for it. `Quote` **is** now local too (added 2026-07-21) — Everly writes its own audit copy in `src/db/models/Quote.ts` at submission time (before the MDR write, so a failed/flaky MDR submission still leaves proof of what was captured), for when the client needs proof of what Everly actually submitted. This is a copy for audit purposes only, not the source of truth: `getLoadQuoteStatus`/`getCarrierForLoad.hasQuoted` (which drive eligibility/threshold decisions) still read MDR's own copy (mock or real), not this one. `loadId`/`carrierId` on `CallAttempt`/`Escalation`/`Quote` are plain strings (MDR's external IDs from `src/mdr/api.ts`), not ObjectId refs. `callVariables.ts` maps a `Load`+`MdrCarrierForLoad` pair into the exact `{{variable}}` names referenced in `prompt.ts` — keep these two files in sync when either changes.

**Mongoose gotcha**: `Model.updateOne()` silently no-ops when setting a `timestamps`-managed `createdAt` field (it reports `modifiedCount: 1` but the value doesn't actually persist). Doesn't affect real application code (which never rewrites `createdAt`), but if you need to backdate a timestamp in a test script, use the raw driver instead: `Model.collection.updateOne(...)`.

## Project documentation (repo root, not code)

This repo's `.md` files each cover distinct, non-overlapping ground — check whether new context belongs in one of these before creating a new file:

- `project-info.md` — the full spec digest from MDR's two source PDFs
- `client-proposal.md` — what was actually sent to the client; treat as a historical record, don't edit
- `build-plan.md` — architecture + the phased build plan + current status of each step
- `requirements-tracker.md` — single source of truth for confirmed config values and what's still needed from the client
- `call-flow.md` — Mermaid diagram of the end-to-end call flow
- `twilio-setup.md` — Twilio account/number setup steps
- `test-cases.md` — manual test plan covering the playbook's 29 minimum test scenarios (Appendix B), including how to start the mock MDR API + webhook receiver + tunnel for live testing
