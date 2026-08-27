import assert from "node:assert/strict";
import { test } from "node:test";
import { createTestDatabase, type TestDatabase } from "@saltbox/database/testing/harness";
import { upsertContactMethod } from "@saltbox/database/repositories/contact-methods";
import { rejectDemoVersion, approveDemoVersion } from "@saltbox/demo-generation/approval";
import { generateDemoForProspect } from "@saltbox/demo-generation/generate";
import { persistDemoQaResult } from "@saltbox/demo-generation/qa";
import { qualifyBusinessV2 } from "@saltbox/qualification/pipeline";
import { qaReport, seedQualifiedProspect, weakSiteIntelligence } from "../../demo-generation/testing/fixtures.ts";
import { selectBestEmailContact, validateEmailAddress } from "../src/contact-selection.ts";
import { senderProfile } from "../src/config.ts";
import { checkOutreachEligibility } from "../src/eligibility.ts";
import { renderOutreachMessage } from "../src/message.ts";
import { prepareOutreach } from "../src/prepare.ts";
import { OUTREACH_SENDING_ENABLED, outreachSendingCapability } from "../src/provider.ts";
import { getProspectOutreachView } from "../src/queries.ts";
import { suppressOutreach } from "../src/suppress.ts";

const OPERATOR = "test-operator";

async function seedReady(ctx: TestDatabase, name: string, externalId: string) {
  const outcome = await seedQualifiedProspect(ctx, name, externalId);
  const generated = await generateDemoForProspect(ctx.db, outcome.prospectId);
  assert.equal(generated.status, "generated");
  if (generated.status !== "generated") throw new Error("fixture generation failed");
  await persistDemoQaResult(ctx.db, { report: qaReport(generated.summary.demoVersionId, generated.summary.locatorToken) });
  const approval = await approveDemoVersion(ctx.db, { demoId: generated.summary.demoId, demoVersionId: generated.summary.demoVersionId, actor: { actorRef: OPERATOR } });
  assert.equal(approval.status, "approved");
  const publication = await ctx.db
    .insertInto("demo_publication")
    .values({
      demo_id: generated.summary.demoId,
      demo_version_id: generated.summary.demoVersionId,
      environment: "hosted",
      status: "published",
      public_url: `https://saltbox-demos.example.test/d/${generated.summary.locatorToken}`,
      actor_type: "operator",
      actor_ref: OPERATOR,
      completed_at: new Date(),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { outcome, generated, publicationId: publication.id };
}

test("email validation normalizes syntax without claiming DNS, MX, or mailbox proof", () => {
  const valid = validateEmailAddress(" Hello@Example.COM ");
  assert.equal(valid.normalized, "hello@example.com");
  assert.equal(valid.syntaxValid, true);
  assert.equal(valid.dnsChecked, false);
  assert.equal(valid.mxChecked, false);
  assert.equal(valid.mailboxConfirmed, false);
  assert.equal(validateEmailAddress("not-an-email").syntaxValid, false);
  assert.equal(validateEmailAddress("bad..dots@example.com").syntaxValid, false);
});

test("contact selection is deterministic, prefers a direct contact, preserves provenance, and rejects noreply", async () => {
  const ctx = await createTestDatabase();
  try {
    const ready = await seedReady(ctx, "Contact Roofing", "contact-roofing");
    const contact = await ctx.db.insertInto("contact").values({ business_id: ready.outcome.businessId, full_name: "Riley Owner", role_title: "Owner" }).returning("id").executeTakeFirstOrThrow();
    await upsertContactMethod(ctx.db, { businessId: ready.outcome.businessId, channel: "email", normalizedValue: "noreply@contact-roofing.test" });
    const directId = await upsertContactMethod(ctx.db, { businessId: ready.outcome.businessId, contactId: contact.id, channel: "email", normalizedValue: "riley@contact-roofing.test", displayValue: "Riley@Contact-Roofing.test" });
    const duplicateId = await upsertContactMethod(ctx.db, { businessId: ready.outcome.businessId, contactId: contact.id, channel: "email", normalizedValue: "riley@contact-roofing.test" });
    assert.equal(duplicateId, directId);
    const first = await selectBestEmailContact(ctx.db, ready.outcome.businessId);
    const second = await selectBestEmailContact(ctx.db, ready.outcome.businessId);
    assert.equal(first.selected?.contactMethodId, directId);
    assert.equal(first.selected?.selectionReason, "DIRECT_KNOWN_CONTACT");
    assert.equal(first.selected?.sourceKind, "contact_method");
    assert.equal(first.selected?.sourceRef, directId);
    assert.deepEqual(second, first);
    assert.ok(first.rejected.some((item) => item.code === "UNDESIRABLE_EMAIL_ADDRESS"));
  } finally {
    await ctx.destroy();
  }
});

test("qualified + approved hosted demo + valid contact is eligible; local-only and no-contact cases are structured", async () => {
  const ctx = await createTestDatabase();
  try {
    const ready = await seedReady(ctx, "Eligible Roofing", "eligible-roofing");
    const eligible = await checkOutreachEligibility(ctx.db, ready.outcome.prospectId);
    assert.equal(eligible.eligible, true);
    assert.equal(eligible.fitScore, 65);
    assert.equal(eligible.artifact?.demoVersionId, ready.generated.summary.demoVersionId);

    await ctx.db.updateTable("demo_publication").set({ status: "superseded" }).where("id", "=", ready.publicationId).execute();
    const localOnly = await checkOutreachEligibility(ctx.db, ready.outcome.prospectId);
    assert.equal(localOnly.eligible, false);
    assert.ok(localOnly.reasons.some((reason) => reason.code === "DEMO_NOT_HOSTED"));

    await ctx.db.deleteFrom("contact_method").where("business_id", "=", ready.outcome.businessId).execute();
    const noContact = await checkOutreachEligibility(ctx.db, ready.outcome.prospectId);
    assert.ok(noContact.reasons.some((reason) => reason.code === "NO_EMAIL_ADDRESS"));
  } finally {
    await ctx.destroy();
  }
});

test("rejected and unapproved prospects remain ineligible", async () => {
  const ctx = await createTestDatabase();
  try {
    const rejectedUrl = "https://rejected-bakery.test/";
    const rejected = await qualifyBusinessV2(ctx.db, {
      name: "Rejected Bakery",
      source: "outreach_fixture",
      externalId: "rejected-bakery",
      industry: "bakery",
      websiteUrl: rejectedUrl,
      email: "hello@rejected-bakery.test",
    }, { analyze: async () => weakSiteIntelligence(rejectedUrl), currentYear: 2026 });
    assert.equal(rejected.decision, "rejected");
    const rejectedEligibility = await checkOutreachEligibility(ctx.db, rejected.prospectId);
    assert.equal(rejectedEligibility.eligible, false);
    assert.ok(rejectedEligibility.reasons.some((reason) => reason.code === "PROSPECT_NOT_QUALIFIED"));

    const qualified = await seedQualifiedProspect(ctx, "Unapproved Outreach Roofing", "unapproved-outreach-roofing");
    const generated = await generateDemoForProspect(ctx.db, qualified.prospectId);
    assert.equal(generated.status, "generated");
    const unapproved = await checkOutreachEligibility(ctx.db, qualified.prospectId);
    assert.equal(unapproved.eligible, false);
    assert.ok(unapproved.reasons.some((reason) => reason.code === "DEMO_NOT_APPROVED"));
  } finally {
    await ctx.destroy();
  }
});

test("message rendering is exact, deterministic, claim-backed, and uses a safe fallback greeting", () => {
  const contact = {
    contactMethodId: "11111111-1111-4111-8111-111111111111",
    contactId: null,
    contactName: null,
    email: "hello@riverfront.test",
    normalizedEmail: "hello@riverfront.test",
    selectionReason: "SHARED_BUSINESS_EMAIL" as const,
    sourceKind: "contact_method" as const,
    sourceRef: "11111111-1111-4111-8111-111111111111",
    confidence: "high" as const,
    validationStatus: "valid",
    validation: validateEmailAddress("hello@riverfront.test"),
  };
  const input = {
    businessName: "Riverfront Roofing\r\nBcc: bad@example.test",
    category: "roofing",
    city: "Ogden",
    state: "UT",
    demoUrl: "https://saltbox-demos.example.test/d/demo-token",
    contact,
    observation: { code: "CTA_MISSING", text: "the site doesn't have a clear quote button", evidenceRef: "analysis-1" },
    sender: senderProfile({}),
  };
  const first = renderOutreachMessage(input);
  const second = renderOutreachMessage(input);
  assert.deepEqual(second, first);
  assert.equal(first.subject, "I rebuilt the Riverfront Roofing Bcc: bad@example.test website");
  assert.ok(first.body.startsWith("Hi,\n\n"));
  assert.ok(first.body.includes("the site doesn't have a clear quote button"));
  assert.ok(first.body.includes(input.demoUrl));
  assert.equal(first.body.includes("losing"), false);
  assert.equal(first.body.includes("\r"), false);
});

test("prepare creates one exact SEND-READY intent, is idempotent, and creates no provider attempt", async () => {
  const ctx = await createTestDatabase();
  try {
    const ready = await seedReady(ctx, "Prepared Roofing", "prepared-roofing");
    const first = await prepareOutreach(ctx.db, { prospectId: ready.outcome.prospectId, actorRef: OPERATOR });
    assert.equal(first.status, "send_ready");
    if (first.status !== "send_ready") return;
    assert.equal(first.message.reused, false);
    assert.equal(first.message.demoVersionId, ready.generated.summary.demoVersionId);
    assert.equal(first.message.providerAttemptCount, 0);

    const second = await prepareOutreach(ctx.db, { prospectId: ready.outcome.prospectId, actorRef: OPERATOR });
    assert.equal(second.status, "send_ready");
    if (second.status !== "send_ready") return;
    assert.equal(second.message.messageId, first.message.messageId);
    assert.equal(second.message.reused, true);
    assert.equal(await ctx.db.selectFrom("message").select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirstOrThrow().then((row) => Number(row.n)), 1);
    assert.equal(await ctx.db.selectFrom("message_attempt").select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirstOrThrow().then((row) => Number(row.n)), 0);
    const persisted = await ctx.db.selectFrom("message").select(["status", "demo_version_id", "hosted_publication_id"]).where("id", "=", first.message.messageId).executeTakeFirstOrThrow();
    assert.equal(persisted.status, "send_ready");
    assert.equal(persisted.demo_version_id, ready.generated.summary.demoVersionId);

    const duplicateCheck = await checkOutreachEligibility(ctx.db, ready.outcome.prospectId, {
      preparedAgainst: {
        idempotencyKey: (await ctx.db.selectFrom("message").select("idempotency_key").where("id", "=", first.message.messageId).executeTakeFirstOrThrow()).idempotency_key,
        contactMethodId: first.eligibility.contact!.contactMethodId,
        demoVersionId: first.eligibility.artifact!.demoVersionId,
        publicLocatorId: first.eligibility.artifact!.publicLocatorId,
        approvalReviewId: first.eligibility.artifact!.approvalReviewId,
        approvedAt: first.eligibility.artifact!.approvedAt,
        hostedPublicationId: first.eligibility.artifact!.hostedPublicationId,
      },
    });
    assert.ok(duplicateCheck.reasons.some((reason) => reason.code === "DUPLICATE_MESSAGE_INTENT"));
  } finally {
    await ctx.destroy();
  }
});

test("approval change makes preparation stale and a new approved version warrants one new intent", async () => {
  const ctx = await createTestDatabase();
  try {
    const ready = await seedReady(ctx, "Versioned Roofing", "versioned-roofing");
    const first = await prepareOutreach(ctx.db, { prospectId: ready.outcome.prospectId, actorRef: OPERATOR });
    assert.equal(first.status, "send_ready");
    if (first.status !== "send_ready") return;
    const next = await generateDemoForProspect(ctx.db, ready.outcome.prospectId, { forceRegenerate: true, composition: "bold" });
    assert.equal(next.status, "generated");
    if (next.status !== "generated") return;
    await persistDemoQaResult(ctx.db, { report: qaReport(next.summary.demoVersionId, next.summary.locatorToken) });
    await approveDemoVersion(ctx.db, { demoId: next.summary.demoId, demoVersionId: next.summary.demoVersionId, actor: { actorRef: OPERATOR } });
    await ctx.db.updateTable("demo_publication").set({ status: "superseded" }).where("demo_id", "=", next.summary.demoId).execute();
    await ctx.db.insertInto("demo_publication").values({ demo_id: next.summary.demoId, demo_version_id: next.summary.demoVersionId, environment: "hosted", status: "published", public_url: `https://saltbox-demos.example.test/d/${next.summary.locatorToken}`, actor_type: "operator", actor_ref: OPERATOR, completed_at: new Date() }).execute();

    const stale = await getProspectOutreachView(ctx.db, ready.outcome.prospectId);
    assert.equal(stale.status, "STALE_PREPARATION");
    assert.ok(stale.eligibility.reasons.some((reason) => reason.code === "APPROVAL_CHANGED"));
    const replaced = await prepareOutreach(ctx.db, { prospectId: ready.outcome.prospectId, actorRef: OPERATOR });
    assert.equal(replaced.status, "send_ready");
    if (replaced.status !== "send_ready") return;
    assert.notEqual(replaced.message.messageId, first.message.messageId);
    assert.equal(replaced.message.demoVersionId, next.summary.demoVersionId);
    const old = await ctx.db.selectFrom("message").select("status").where("id", "=", first.message.messageId).executeTakeFirstOrThrow();
    assert.equal(old.status, "cancelled");
  } finally {
    await ctx.destroy();
  }
});

test("suppression after preparation immediately blocks eligibility and preserves the historical intent", async () => {
  const ctx = await createTestDatabase();
  try {
    const ready = await seedReady(ctx, "Suppressed Outreach Roofing", "suppressed-outreach-roofing");
    const prepared = await prepareOutreach(ctx.db, { prospectId: ready.outcome.prospectId, actorRef: OPERATOR });
    assert.equal(prepared.status, "send_ready");
    if (prepared.status !== "send_ready") return;
    await suppressOutreach(ctx.db, { prospectId: ready.outcome.prospectId, scope: "prospect", reason: "Operator do-not-contact decision", actorRef: OPERATOR });
    const view = await getProspectOutreachView(ctx.db, ready.outcome.prospectId);
    assert.equal(view.status, "SUPPRESSED");
    assert.equal(view.eligibility.eligible, false);
    assert.ok(view.eligibility.reasons.some((reason) => reason.code === "ACTIVE_SUPPRESSION"));
    assert.equal(view.message?.messageId, prepared.message.messageId);
    assert.equal(view.message?.persistedStatus, "suppressed");
    assert.equal(await ctx.db.selectFrom("message_attempt").select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirstOrThrow().then((row) => Number(row.n)), 0);
  } finally {
    await ctx.destroy();
  }
});

test("withdrawing approval makes a prepared message ineligible and Phase 11 has no sender", async () => {
  const ctx = await createTestDatabase();
  try {
    const ready = await seedReady(ctx, "Revoked Roofing", "revoked-roofing");
    const prepared = await prepareOutreach(ctx.db, { prospectId: ready.outcome.prospectId, actorRef: OPERATOR });
    assert.equal(prepared.status, "send_ready");
    await rejectDemoVersion(ctx.db, { demoId: ready.generated.summary.demoId, demoVersionId: ready.generated.summary.demoVersionId, actor: { actorRef: OPERATOR }, note: "withdraw approval" });
    const eligibility = await checkOutreachEligibility(ctx.db, ready.outcome.prospectId);
    assert.equal(eligibility.eligible, false);
    assert.ok(eligibility.reasons.some((reason) => reason.code === "DEMO_NOT_APPROVED"));
    assert.equal(OUTREACH_SENDING_ENABLED, false);
    assert.deepEqual(outreachSendingCapability().provider, null);
    assert.equal(await ctx.db.selectFrom("message_attempt").select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirstOrThrow().then((row) => Number(row.n)), 0);
  } finally {
    await ctx.destroy();
  }
});
