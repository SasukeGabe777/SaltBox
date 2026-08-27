# Outreach Foundations — Phase 11

Phase 11 prepares the exact email SaltBox may later send while making an
external send impossible. Its terminal state is **SEND-READY**, never sent.

```text
READY FOR OUTREACH
        ↓
deterministic email contact selection
        ↓
current outreach eligibility
        ↓
campaign + immutable sequence version
        ↓
provider-neutral Message intent
        ↓
evidence-backed deterministic email
        ↓
exact approved DemoVersion + publication pin
        ↓
final suppression / staleness / idempotency check
        ↓
SEND-READY                 (zero external I/O)
```

## Hard invariants

1. **No message may become sendable without outreach eligibility at the time
   of send.** Phase 11 checks before and after preparation. A future provider
   adapter must call the same service immediately before creating a transport
   attempt or performing external I/O.
2. Qualification, demo approval, and `READY FOR OUTREACH` do not permanently
   grant eligibility. Suppression, contact state, approval, locator, and
   publication can change.
3. `message` is communication intent; `message_attempt` is provider transport.
   Phase 11 creates no attempt and never writes `sent` or a provider ID.
4. Every prepared email pins the exact `demo_version`, approval review,
   approval timestamp, public locator, hosted publication, and URL used.
5. The stable URL is not proof that the underlying approved artifact stayed
   the same. Any changed pin makes the preparation stale.
6. Active suppression wins over score, readiness, approval, campaign, and
   operator preparation. Historical drafts remain.
7. Repeating preparation with unchanged prospect, sequence version, step,
   contact, and DemoVersion reuses the same intent.
8. There is no provider adapter, send route, send method, SMTP/API client, or
   SEND button in Phase 11.

## Eligibility

`checkOutreachEligibility(db, prospectId, options)` returns `eligible`, stable
machine-readable reason codes, references, the selected contact, current fit
score, and an exact hosted-demo snapshot.

The policy checks active identity; the latest `qualification-policy-v2`
decision; all applicable suppression scopes against the database clock; a
usable persisted email; clean QA; exact approval, locator, and hosted
publication; successful recent outreach; duplicate intent; and stored pins.

Representative codes include `ACTIVE_SUPPRESSION`, `NO_EMAIL_ADDRESS`,
`INVALID_EMAIL_ADDRESS`, `PROSPECT_NOT_QUALIFIED`, `DEMO_NOT_APPROVED`,
`DEMO_QA_UNSAFE`, `DEMO_NOT_HOSTED`, `RECENT_OUTREACH_EXISTS`,
`DUPLICATE_MESSAGE_INTENT`, and the four stale-preparation codes.

## Contact selection and validation

Only persisted email contact methods are candidates. Ranking is deterministic:

1. active, named direct contact;
2. address on the business's website domain;
3. shared role mailbox such as `hello@`, `contact@`, or `info@`;
4. another valid persisted business address.

Validation status, confidence, and delivery health break ties before a stable
lexical tie-break. Addresses such as `noreply@`, `donotreply@`, and
`mailer-daemon@` are rejected. The normalized address, selection reason,
contact-method reference, confidence, and validation result are persisted.

Validation is honest: syntax and domain syntax are checked locally. No probe is
sent and Phase 11 does not perform DNS/MX lookup or claim that a mailbox exists.

## Campaign and sequence v1

- Campaign: `SaltBox Demo Outreach — Local Services v1`
- Policy/version: `outreach-eligibility-v1`
- Sequence: `saltbox-demo-outreach`, version `1`
- Step 1: `initial_demo_email`, prepared in Phase 11
- Step 2: `future_follow_up`, modeled only, suggested delay 4 days
- Step 3: `future_final_follow_up`, modeled only, suggested delay 7 days

The campaign remains `draft`. The sequence definition explicitly prohibits
automatic scheduling. Follow-up behavior is later work.

## Deterministic email v1

The active subject template is `outreach-subject-rebuilt-v1`:

```text
I rebuilt the {{business_name}} website
```

Two small inactive alternatives are registered for later versioned experiments;
Phase 11 does not optimize on opens. The body template
`outreach-body-demo-v1` is short, proof-first, and includes at most one claim
selected from persisted website-intelligence evidence. Unsupported revenue,
traffic, conversion-loss, competitor, customer-sentiment, and owner-name claims
are impossible in the renderer.

The rendered payload, versions, evidence reference, contact selection,
sender-profile version, and demo pins are stored on the Message intent. The
admin preview reads that persisted payload—the same payload a future adapter
would receive after another eligibility check.

## Sender identity and compliance boundary

`saltbox-sender-v1` is configuration. `SaltBox` is the real product/business
identity used in the Phase 11 signature. Sender email, reply-to, and mailing
address have no fabricated defaults. Missing values appear as Phase 12
operator requirements.

Before delivery is enabled, an operator must supply a verified sender,
monitored reply-to, real business/footer address, accurate identity, and a
working opt-out route. This is a product safety boundary, not legal advice.

## Suppression, unsubscribe, and replies

The existing `suppression` table now supports prospect scope. The admin can
record DO NOT CONTACT at prospect, business, or selected-email scope. Pending
intents become `suppressed`, while history remains.

Future unsubscribe handling must atomically record the inbound event, activate
the applicable hard suppression, and make every pending message ineligible. A
future reply must stop sequence progression, retain thread lineage, and raise
human sales attention. No webhook, preference center, bounce processor, or
reply ingestion exists yet.

## Admin, events, and cost boundary

The prospect case file shows eligibility, structured blockers, contact,
campaign/sequence, exact demo, deterministic payload, persisted versions,
attempt count, and Phase 12 sender requirements. `/outreach` classifies the
queue as `READY_FOR_OUTREACH`, `DRAFT_PREPARED`, `SEND_READY`, `SUPPRESSED`,
`NEEDS_CONTACT`, `NEEDS_DEMO_APPROVAL`, `NEEDS_RETRY`, or
`STALE_PREPARATION`. Bulk preparation is hard-capped at 10.

Phase 11 emits eligibility, preparation, intent, SEND-READY, and suppression
events. It never emits `email_sent`. Preparation records no fake CostEntry;
the existing MessageAttempt and cost references remain available later.

## Fit, future intent, and human calls

Qualification remains the Fit Score. A later Intent Score should emphasize
reliable engagement with the exact hosted DemoVersion: verified visit, repeat
session, meaningful engaged time, multiple sections, and CTA/contact interest.
Email opens are noisy and, if used at all, should remain weak evidence.

```text
FIT SCORE + INTENT SCORE → prioritized human follow-up

first demo view             → observe
repeat meaningful visit     → intent rises
multiple meaningful visits  → candidate for human call
CTA/contact interest        → high-priority human call
reply                       → stop automation; human sales queue
not interested              → immediate suppression
```

Do not call every recipient. Phase 11 implements no call task, SMS, AI calling,
robocalling, or Intent Score.

## Migration and known limitations

Migration `1787702400007_outreach-send-ready.sql` extends the existing Message
and Suppression structures because exact demo pinning, preparation lifecycle,
and prospect-scoped safety could not be represented correctly without it. No
parallel campaign/message schema was added.

Phase 11 intentionally has no email provider, credentials, SMTP, delivery,
automated follow-up, reply ingestion, bounce handling, unsubscribe endpoint,
engagement tracking, Intent Score, human-call queue, SMS, billing, or AI copy.
