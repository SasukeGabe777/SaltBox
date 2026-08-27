# @saltbox/outreach

Phase 11's deterministic outreach-preparation domain. It turns a currently
eligible prospect into one provider-neutral `message` intent and stops at
`send_ready`.

```text
READY FOR OUTREACH
  -> select persisted email
  -> current eligibility check
  -> campaign + immutable sequence version
  -> deterministic evidence-backed copy
  -> exact approved DemoVersion/publication pin
  -> final eligibility check
  -> SEND-READY
```

There is no transport adapter, SMTP client, provider credential shape, send
method, send route, or SEND button. `provider.ts` exposes only a disabled
capability description. A future provider boundary must call
`checkOutreachEligibility` immediately before external I/O and before creating
a `message_attempt`.

The first configuration is:

- campaign: `SaltBox Demo Outreach — Local Services v1`
- eligibility policy: `outreach-eligibility-v1`
- sequence: `saltbox-demo-outreach`, immutable version `1`
- initial content: `saltbox-demo-email-v1`
- subject: `outreach-subject-rebuilt-v1`
- body: `outreach-body-demo-v1`
- sender profile: `saltbox-sender-v1`

Run its tests with `pnpm --filter @saltbox/outreach test`.
