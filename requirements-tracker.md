# Requirements Tracker

Single source of truth for what's confirmed, what's still open, and what blocks which build step. Merged from the former prerequisites.md + confirmed-config.md + call-agenda.md. Build steps referenced here live in [build-plan.md](build-plan.md).

## Confirmed by the client (Frank Caputo)

### Accounts
- **Vapi account**: provided (`ibr.suhel@gmail.com` + API key) — verified working, stored in local `.env`, not committed.
- **Twilio account**: not yet provided.
- **Phone number**: area code **757** requested. Source (new Vapi-provisioned vs. ported via Twilio) still to confirm — see [twilio-setup.md](twilio-setup.md).

### Agent identity
- **Agent name**: **Everly**
- Should reuse the **same name and personality as the MDR chatbot**, for a consistent experience across the platform — we need that chatbot's persona/prompt to match against, not just the adjectives below.
- **Personality**: friendly, professional, knowledgeable, conversational, efficient — explicitly **never pushy or overly sales-oriented**.

### Default business rules
| Setting | Confirmed value |
|---|---|
| Quote threshold | 3 quotes |
| Email wait time before AI begins calling | 30 minutes |
| Maximum call attempts per carrier | 4 attempts |
| Attempt cadence | 1st: after the 30-min email wait · 2nd: 1 hour after 1st · 3rd: 2 hours after 2nd · 4th: next business morning (only if stop conditions still not met) |
| Calling hours | Mon–Fri, 8:00 AM–5:00 PM, **carrier's local time zone** |
| Voicemail | Yes — leave a professional voicemail if no answer |
| Call recording | Yes — record all calls where legally permitted; store recording + transcript + summary with the call record |
| AI disclosure | Yes — must clearly disclose it's an AI representative at the start of the call, using **approved disclosure language** (exact wording not yet provided) |

**Configurability requirement**: these are the **defaults**, but must remain editable per broker/shipper inside MDR — the config layer needs per-account overrides, not just one global default.

Note: the confirmed attempt cadence calls the same carrier up to 3 times in one day before falling back to the next business morning for the 4th — this is a deliberate client override of the playbook's own suggested default ("avoid repeated same-day calls unless requested"), not a conflict to raise back with them.

### Process validation
Frank's message included his own step-by-step description of the flow (load posted → bid emails → wait window → quote count check → AI carrier selection → AI call → quote capture → save to MDR → continue until stop condition). This matches [call-flow.md](call-flow.md) exactly — confirms our understanding and the client's mental model are aligned.

## Prerequisites checklist, by build step

### Blocking now — before Step 1
- [x] Vapi account + API key — received and verified
- [ ] Phone number source decision (Twilio vs. native Vapi) — area code known, account not
- [ ] Hosting decision for the orchestration service
- [ ] Repo/access setup

### Before Step 2 (assistant/script build)
- [x] Agent name — Everly
- [ ] MDR chatbot persona/prompt reference, to match Everly's tone to it
- [ ] Exact approved AI-disclosure and call-recording consent wording

### Before Step 6 (real MDR integration)
- [ ] MDR API documentation
- [ ] Sandbox/staging credentials
- [ ] Technical point of contact
- [ ] Confirmation of what MDR's API can read/write — see the detailed API list below

### MDR API list — to hand to their technical contact

**Read**
- Get Load(s) — pickup/delivery, equipment, timing, cargo, service scope, pricing rules, disclosure settings, quote threshold
- Get Load Quote Status — current valid quote count vs. required threshold
- Get Carrier(s) — contact info, MC/USDOT, insurance, eligibility, do-not-call status, service history, lanes/equipment
- Get Existing Quotes for a Load — which carriers already quoted, by any channel

**Write**
- Submit Quote — base rate, fuel, chassis, accessorials, total, capacity, validity, scope, confirmation flag
- Log Decline — standardized reason + free-text note
- Schedule Callback — date/time/time zone
- Log Escalation — reason, question, preferred contact method
- Update Carrier Record — contact corrections, DNC flag, communication preference
- Attach Call Record — transcript, recording link, summary, outcome, sentiment, agent/prompt version

**Config**
- Get/Set Account Settings — Appendix A values, per broker/shipper account (not global)

**Events/webhooks (preferred; polling as fallback)**
- New load posted
- Carrier responded by email
- Threshold met / bid closed / load awarded — most time-sensitive, prevents calling a carrier on an already-covered load
- Load paused/cancelled by user

**Access**
- Auth mechanism (API key, OAuth, etc.)
- Separate sandbox/staging credentials with test data

### Before Step 8 (configuration layer)
- [x] Quote threshold, email wait time, max attempts + cadence, calling window, voicemail policy, call recording policy — all confirmed, see table above
- [ ] Target-rate sharing policy
- [ ] Negotiation authority
- [ ] Auto-submit confidence / human-review policy
- [ ] Notification preferences

### Before Step 9 (QA sign-off)
- [ ] Designated MDR reviewer for transcripts/recordings

### Before Step 10 (pilot / go-live)
- [ ] Real or test carrier contacts
- [ ] Legal/compliance final sign-off on disclosure & recording wording (exact text, not just "yes")
- [ ] Confirmation of MDR's do-not-call list process
- [ ] Outbound-calling registration (Trust Hub / SHAKEN-STIR) if using a new number — see [twilio-setup.md](twilio-setup.md)

### Parallel / non-blocking
- Who owns and pays for the Vapi account billing
- Target go-live date or trigger

**Bottom line**: most config-layer values are confirmed. Steps 1–5 can proceed now. The main blockers before a real carrier gets called are the exact disclosure/consent wording and the phone-number source.

## Open questions queued for the call with Frank

1. Twilio account — do you have one already, or should Vapi provision a new number natively in area code 757?
2. Who owns/pays for the Vapi account's usage billing going forward?
3. Can you share the existing MDR chatbot's persona/prompt definition (or a transcript example) so Everly's tone matches it exactly?
4. Any preference on Everly's voice (accent, pitch, gender-presentation) within Vapi's available TTS voices?
5. What's the exact approved wording for the AI-disclosure statement Everly should use at the start of every call?
6. Same question for the call-recording consent language, and whether it varies by state/jurisdiction.
7. Can carriers be told the broker/shipper's identity if they ask, or should that stay undisclosed during bidding?
8. Can Everly share a target rate with carriers if asked, or should that always be declined?
9. Does Everly have any negotiation flexibility, or does she only ever record whatever rate the carrier states?
10. Should every AI-collected quote go through human review before it's finalized in MDR, or only exceptions/low-confidence ones? What's the confidence bar for auto-submitting?
11. Who should be notified when a quote comes in, a carrier declines, or an escalation happens — and how often?
12. Can we get MDR API documentation, sandbox/staging credentials, and a technical point of contact?
13. Can you provide a handful of real or test carrier contacts for a staging test round?
14. Who will review sample call transcripts/recordings and give sign-off before go-live?
15. Is there a target go-live date or a specific load volume that should shape build priority?
16. Is the provided Vapi account dedicated to MDR, or shared with other projects? (It already has an unrelated assistant, "Riley," configured — a health-clinic scheduling bot.)
