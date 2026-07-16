# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Everly** — an AI voice agent built on Vapi that calls freight carriers on behalf of My Dray Rate (MDR), a drayage marketplace, to collect rate quotes on loads that haven't gotten enough email responses. This repo implements MDR's own "Carrier Bid Follow-Up" playbook (the two PDFs in the repo root) as a working system: a Vapi assistant + an orchestration service that decides who to call and when.

## Commands

```bash
npm install                # install deps
npm run typecheck          # tsc --noEmit — run this after any change, no test suite exists yet
npm run db:seed            # wipes and reseeds mock loads/carriers into MongoDB (dev only)
npm run assistant:create   # creates the Everly assistant in Vapi, or updates it if EVERLY_ASSISTANT_ID is set in .env
npm run dispatch:run       # runs a single orchestration cycle (eligibility scan → queue → dial) and exits
npm run server:dev         # starts the Express webhook receiver on $PORT (default 3000), with reload
```

There is no lint config and no automated test suite — verification so far has been done by running the actual scripts above against the live Vapi API and a real MongoDB Atlas cluster (not mocks). When changing orchestration logic, prefer writing a throwaway script (delete it after) that runs the real flow end-to-end over trusting typecheck alone — this repo has already caught real bugs (a timezone calculation error, a Mongoose `updateOne`-on-`createdAt` no-op) that typechecking did not.

## Required environment (`.env`, see `.env.example`)

`VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID`, `EVERLY_ASSISTANT_ID` (set after first `assistant:create` run), `MONGODB_URI`. Twilio and MDR API vars are intentionally omitted until those integrations start — see `requirements-tracker.md`.

**Dev-phase note**: the Vapi account and MongoDB cluster currently in use are the developer's own, not the client's. Before Phase 2 (real MDR integration) or any real carrier call, these need to swap to the client's Vapi account and a Twilio number with Trust Hub business verification — tracked in `requirements-tracker.md` and `twilio-setup.md`.

## Architecture

The system has three layers that only talk to each other through MongoDB and the Vapi API — there's no direct function-call coupling between them:

1. **`src/assistant/`** — defines Everly herself. `prompt.ts` is the entire conversational script (converted near-verbatim from the playbook PDF's sections 1-18), with `{{variable}}` placeholders. `tools.ts` defines the 6 function-calling tools (`submit_quote`, `log_decline`, `schedule_callback`, `escalate_to_human`, `record_do_not_call`, `update_contact`) that turn conversation into structured data. `create.ts` pushes both to Vapi via `POST/PATCH /assistant`.

2. **`src/orchestration/`** — the decision-making pipeline, run via `dispatch:run` (intended to be invoked repeatedly/on a schedule, not long-running):
   `eligibility.ts` (which loads need outreach) → `queueBuilder.ts` (which carriers are eligible, ranked) → `cadence.ts` + `callingWindow.ts` (is this specific attempt actually due right now, timezone-aware) → `dispatcher.ts` (ties it together, creates the `CallAttempt`, places the real Vapi call) → `stopConditions.ts` (re-checked after every single call, not just per batch — cancels further outreach the moment a load's quote threshold is met).

3. **`src/server/`** — the Express webhook receiver Vapi calls back into. `webhookHandlers.ts` handles two message types: `tool-calls` (mid-call, e.g. `submit_quote`) and `end-of-call-report` (post-call transcript/recording/summary).

**Non-obvious design decision**: tool schemas in `tools.ts` deliberately do **not** include `loadId`/`carrierId` as LLM-supplied parameters — the model has no reliable way to know MongoDB's internal IDs (only `carrierName` etc. are exposed as prompt variables). Instead, `webhookHandlers.ts` resolves the load/carrier/call-attempt context server-side by matching the webhook's `message.call.id` against the `CallAttempt.vapiCallId` that was recorded when the call was dispatched. If you add a new tool, follow this pattern rather than adding ID parameters back.

**Idempotency**: `CallAttempt` has a unique compound index on `(loadId, carrierId, attemptNumber)`. The dispatcher relies on this — if two dispatch runs race for the same attempt slot, the loser's insert throws a duplicate-key error (code 11000), which is caught and treated as "already claimed," not an error.

**`createdAt` as a proxy**: `cadence.ts` treats `Load.createdAt` as the bid-email-sent timestamp, since there's no separate MDR-provided field for that yet. This is a documented placeholder to revisit once real MDR integration (Phase 2) lands.

**Data model** (`src/db/models/`): `Load`, `Carrier`, `CallAttempt`, `Quote`, `Escalation`. Quotes carry a `version`/`status` (`pending_review`/`valid`/`invalid`/`superseded`) for the duplicate-control and validation logic described in the playbook. `callVariables.ts` maps a `Load`+`Carrier` pair into the exact `{{variable}}` names referenced in `prompt.ts` — keep these two files in sync when either changes.

**Mongoose gotcha**: `Model.updateOne()` silently no-ops when setting a `timestamps`-managed `createdAt` field (it reports `modifiedCount: 1` but the value doesn't actually persist). Doesn't affect real application code (which never rewrites `createdAt`), but if you need to backdate a timestamp in a test script, use the raw driver instead: `Model.collection.updateOne(...)`.

## Project documentation (repo root, not code)

This repo's `.md` files each cover distinct, non-overlapping ground — check whether new context belongs in one of these before creating a new file:

- `project-info.md` — the full spec digest from MDR's two source PDFs
- `client-proposal.md` — what was actually sent to the client; treat as a historical record, don't edit
- `build-plan.md` — architecture + the phased build plan + current status of each step
- `requirements-tracker.md` — single source of truth for confirmed config values and what's still needed from the client
- `call-flow.md` — Mermaid diagram of the end-to-end call flow
- `twilio-setup.md` — Twilio account/number setup steps
