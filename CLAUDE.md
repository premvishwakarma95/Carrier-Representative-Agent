# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Everly** — an AI voice agent built on Vapi that calls freight carriers on behalf of My Dray Rate (MDR), a drayage marketplace, to collect rate quotes on loads that haven't gotten enough email responses. This repo implements MDR's own "Carrier Bid Follow-Up" playbook (the two PDFs in the repo root) as a working system: a Vapi assistant + an orchestration service that decides who to call and when.

## Commands

```bash
npm install                # install deps
npm run typecheck          # tsc --noEmit — run this after any change, no test suite exists yet
npm run mock-mdr:dev        # starts the mock MDR API on $MOCK_MDR_PORT (default 4000), with reload — start this before dispatch:run/server:dev
npm run db:reset            # clears local operational data (CallAttempt/Escalation); mock MDR data resets via POST /mock/reset on that service instead
npm run assistant:create   # creates the Everly assistant in Vapi, or updates it if EVERLY_ASSISTANT_ID is set in .env
npm run dispatch:run       # runs a single orchestration cycle (eligibility scan → queue → dial) and exits
npm run server:dev         # starts the Express webhook receiver on $PORT (default 3000), with reload
```

There is no lint config and no automated test suite — verification so far has been done by running the actual scripts above against the live Vapi API and a real MongoDB Atlas cluster (not mocks). When changing orchestration logic, prefer writing a throwaway script (delete it after) that runs the real flow end-to-end over trusting typecheck alone — this repo has already caught real bugs (a timezone calculation error, a Mongoose `updateOne`-on-`createdAt` no-op) that typechecking did not.

## Required environment (`.env`, see `.env.example`)

`VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID`, `EVERLY_ASSISTANT_ID` (set after first `assistant:create` run), `MONGODB_URI`, `MDR_API_BASE_URL`/`MDR_API_KEY`/`MDR_ACCOUNT_ID` (point at the mock MDR service by default — see Architecture below). Twilio vars are intentionally omitted until that integration starts — see `requirements-tracker.md`.

**Dev-phase note**: the Vapi account and MongoDB cluster currently in use are the developer's own, not the client's, and `MDR_API_BASE_URL` points at the mock MDR service (`src/mock-mdr-api/`), not the client's real API — they haven't built it yet (see `Everly_MDR_API_Workload_Timeline_Estimation.pdf`). Before Phase 2 (real MDR integration) or any real carrier call, these need to swap to the client's Vapi account, the client's real MDR API, and a Twilio number with Trust Hub business verification — tracked in `requirements-tracker.md` and `twilio-setup.md`.

## Architecture

Four layers. `src/mdr/`, `src/orchestration/`, and `src/server/` only talk to each other through the MDR API and MongoDB — there's no direct function-call coupling between them:

1. **`src/assistant/`** — defines Everly herself. `prompt.ts` is the entire conversational script (converted near-verbatim from the playbook PDF's sections 1-18), with `{{variable}}` placeholders. `tools.ts` defines the 6 function-calling tools (`submit_quote`, `log_decline`, `schedule_callback`, `escalate_to_human`, `record_do_not_call`, `update_contact`) that turn conversation into structured data. `create.ts` pushes both to Vapi via `POST/PATCH /assistant`.

2. **`src/mdr/`** — the MDR API client (`client.ts` fetch wrapper + `api.ts` typed functions). Everly never queries load/carrier/quote data directly from a database — it always goes through this client, which talks to `MDR_API_BASE_URL`. Today that's the mock service below; once the client builds their real API (see `Everly_MDR_API_Workload_Timeline_Estimation.pdf` and the open questions in `requirements-tracker.md`), swapping over is a `MDR_API_BASE_URL`/`MDR_API_KEY` change only — no orchestration code should need to change.

3. **`src/mock-mdr-api/`** — a standalone Express service (own port, `npm run mock-mdr:dev`) implementing the client's proposed 7-endpoint API with in-memory fake data, so Everly can be built and tested against the real integration shape before the client's API exists. Two fields it returns aren't in the client's spec — `Load.invitedCarrierIds` and `Load.timing.bidEmailSentAt` — marked `GAP-FILL` in code; they correspond to open questions already sent to the client. See `src/mock-mdr-api/README.md`.

4. **`src/orchestration/`** — the decision-making pipeline, run via `dispatch:run` (intended to be invoked repeatedly/on a schedule, not long-running):
   `eligibility.ts` (which loads need outreach, via the MDR client) → `queueBuilder.ts` (which invited carriers are eligible, ranked) → `cadence.ts` + `callingWindow.ts` (is this specific attempt actually due right now, timezone-aware) → `dispatcher.ts` (ties it together, creates the local `CallAttempt`, places the real Vapi call) → `stopConditions.ts` (re-checked after every single call, not just per batch — reads MDR's quote-status endpoint, never writes load status back since MDR owns that).

5. **`src/server/`** — the Express webhook receiver Vapi calls back into. `webhookHandlers.ts` handles two message types: `tool-calls` (mid-call — `submit_quote` and `record_do_not_call` write through to the MDR client; `log_decline`/`schedule_callback`/`escalate_to_human` stay local only, since MDR has no endpoints for them yet; `update_contact` is a no-op/log, since MDR has no endpoint for it at all) and `end-of-call-report` (post-call transcript/recording/summary, stored locally).

**Non-obvious design decision**: tool schemas in `tools.ts` deliberately do **not** include `loadId`/`carrierId` as LLM-supplied parameters — the model has no reliable way to know these IDs (only `carrierName` etc. are exposed as prompt variables). Instead, `webhookHandlers.ts` resolves the load/carrier/call-attempt context server-side by matching the webhook's `message.call.id` against the `CallAttempt.vapiCallId` that was recorded when the call was dispatched. If you add a new tool, follow this pattern rather than adding ID parameters back.

**Idempotency**: `CallAttempt` has a unique compound index on `(loadId, carrierId, attemptNumber)`. The dispatcher relies on this — if two dispatch runs race for the same attempt slot, the loser's insert throws a duplicate-key error (code 11000), which is caught and treated as "already claimed," not an error.

**Data model** (`src/db/models/`): only `CallAttempt` and `Escalation` remain as local Mongoose models — Everly's own operational/audit data, which has no MDR equivalent. `loadId`/`carrierId` on both are plain strings (MDR's external IDs from `src/mdr/api.ts`), not ObjectId refs — `Load`, `Carrier`, and `Quote` used to be local models but were removed; that data now lives behind the MDR API (mock or real). `callVariables.ts` maps an `MdrLoad`+`MdrCarrier` pair (types in `src/mdr/api.ts`) into the exact `{{variable}}` names referenced in `prompt.ts` — keep these two files in sync when either changes.

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
