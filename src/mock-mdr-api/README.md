# Mock MDR API

Stands in for the real MDR API described in `Everly_MDR_API_Workload_Timeline_Estimation.pdf`, until the client builds and confirms it. Everly's orchestration engine (`src/mdr/client.ts`) talks to this exactly as it will talk to the real API later — swapping over is a `MDR_API_BASE_URL`/`MDR_API_KEY` change, not a rewrite.

## Run

```bash
npm run mock-mdr:dev
```

Defaults to port 4000, auth key `mock-api-key` (override via `MOCK_MDR_PORT` / `MDR_API_KEY`). Data is in-memory and resets on restart, or via `POST /mock/reset`.

## Endpoints

Implements the client's 7 proposed endpoints (A-G in the PDF) plus one addition **not** in the client's spec:

- `GET /api/everly/loads` — lists load ids/status. The PDF has no load-discovery endpoint at all (`GET /loads/{id}` requires already knowing the id) — Everly has no other way to find loads that need outreach.

## GAP-FILL fields

Two fields in `data.ts` don't exist in the client's PDF and are marked `GAP-FILL` in code — they correspond to open questions already sent to the client (see `requirements-tracker.md`):

- `Load.timing.bidEmailSentAt` — needed for the call-cadence timing math; not explicit in the PDF's Load Details fields.
- `Load.invitedCarrierIds` — needed to know which carriers were actually invited on a specific bid, vs. the general carrier eligibility directory (C), which isn't load-scoped.

When the client answers, reconcile these against whatever they actually build — the field names/shapes here are our best guess, not confirmed.
