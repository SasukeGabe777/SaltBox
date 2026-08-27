/**
 * Phase 10 approval invariant tests.
 *
 * The product rule under test: ONLY AN APPROVED DemoVersion may later be used
 * for outreach. Generation, QA success, and "latest" must never be mistaken
 * for approval, and approval must never move on its own.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveDemoByLocator, getProspectDemoView } from "@saltbox/database/queries/demos";
import { getApprovedDemoVersion, listDemoVersionReviews } from "@saltbox/database/repositories/demo-review";
import { activateSuppression } from "@saltbox/database/repositories/suppressions";
import { createTestDatabase } from "@saltbox/database/testing/harness";
import { approveDemoVersion, rejectDemoVersion } from "../src/approval.ts";
import { generateDemoForProspect } from "../src/generate.ts";
import { persistDemoQaResult } from "../src/qa.ts";
import { qaReport, seedQualifiedProspect } from "./fixtures.ts";

const OPERATOR = { actorRef: "test-operator" };

test("generation does not approve, and a QA pass still does not approve", async () => {
  const ctx = await createTestDatabase();
  try {
    const outcome = await seedQualifiedProspect(ctx, "Unapproved Roofing", "unapproved-roofing");
    const generated = await generateDemoForProspect(ctx.db, outcome.prospectId);
    assert.equal(generated.status, "generated");
    if (generated.status !== "generated") return;

    assert.equal(generated.summary.approvedDemoVersionId, null, "generation must not approve");
    assert.equal(generated.summary.isApproved, false);
    assert.equal(await getApprovedDemoVersion(ctx.db, generated.summary.demoId), undefined);

    // A clean QA pass is evidence, not authorization.
    const { evaluation } = await persistDemoQaResult(ctx.db, {
      report: qaReport(generated.summary.demoVersionId, generated.summary.locatorToken),
    });
    assert.equal(evaluation.status, "passed");
    assert.equal(evaluation.criticalFailures.length, 0);
    assert.equal(
      await getApprovedDemoVersion(ctx.db, generated.summary.demoId),
      undefined,
      "a QA pass must not imply approval",
    );

    // The public locator serves nothing until an operator approves.
    const publicView = await resolveDemoByLocator(ctx.db, generated.summary.locatorToken, { mode: "public" });
    assert.equal(publicView, undefined, "unapproved demos are not publicly resolvable");
    const preview = await resolveDemoByLocator(ctx.db, generated.summary.locatorToken, { mode: "preview" });
    assert.ok(preview, "the operator can still preview the current version locally");

    const view = await getProspectDemoView(ctx.db, outcome.prospectId);
    assert.equal(view?.readiness.readyForOutreach, false);
    assert.ok(view?.readiness.blockers.some((blocker) => blocker.includes("approved by an operator")));
  } finally {
    await ctx.destroy();
  }
});

test("approval pins one exact version; regeneration never moves it, and approving the new one does", async () => {
  const ctx = await createTestDatabase();
  try {
    const outcome = await seedQualifiedProspect(ctx, "Pinned Roofing", "pinned-roofing");
    const first = await generateDemoForProspect(ctx.db, outcome.prospectId);
    assert.equal(first.status, "generated");
    if (first.status !== "generated") return;
    const { demoId, locatorToken } = first.summary;

    await persistDemoQaResult(ctx.db, { report: qaReport(first.summary.demoVersionId, locatorToken) });
    const approval = await approveDemoVersion(ctx.db, {
      demoId,
      demoVersionId: first.summary.demoVersionId,
      actor: OPERATOR,
      note: "looks right",
    });
    assert.equal(approval.status, "approved");

    // Approving again is idempotent, not a second approval record.
    const again = await approveDemoVersion(ctx.db, {
      demoId,
      demoVersionId: first.summary.demoVersionId,
      actor: OPERATOR,
    });
    assert.equal(again.status, "already_approved");

    const publicV1 = await resolveDemoByLocator(ctx.db, locatorToken, { mode: "public" });
    assert.equal(publicV1?.version.versionNumber, 1);

    // Regenerate: a new current version appears, approval stays on v1.
    const second = await generateDemoForProspect(ctx.db, outcome.prospectId, {
      forceRegenerate: true,
      regenerationReason: "operator asked for a different composition",
      composition: "bold",
    });
    assert.equal(second.status, "generated");
    if (second.status !== "generated") return;
    assert.equal(second.summary.versionNumber, 2);
    assert.equal(second.summary.templateName, "local-service-bold", "composition override is honoured");
    assert.equal(second.summary.approvedDemoVersionId, first.summary.demoVersionId);
    assert.equal(second.summary.isApproved, false);
    assert.equal(second.summary.locatorToken, locatorToken, "the public locator is stable across regeneration");

    const stillV1 = await resolveDemoByLocator(ctx.db, locatorToken, { mode: "public" });
    assert.equal(stillV1?.version.versionNumber, 1, "the public URL keeps serving the approved version");
    const previewV2 = await resolveDemoByLocator(ctx.db, locatorToken, { mode: "preview" });
    assert.equal(previewV2?.version.versionNumber, 2, "the operator previews the new version");

    // Approving v2 switches the same locator to v2.
    await persistDemoQaResult(ctx.db, { report: qaReport(second.summary.demoVersionId, locatorToken) });
    const moved = await approveDemoVersion(ctx.db, {
      demoId,
      demoVersionId: second.summary.demoVersionId,
      actor: OPERATOR,
    });
    assert.equal(moved.status, "approved");
    if (moved.status !== "approved") return;
    assert.equal(moved.summary.previousApprovedDemoVersionId, first.summary.demoVersionId);
    const nowV2 = await resolveDemoByLocator(ctx.db, locatorToken, { mode: "public" });
    assert.equal(nowV2?.version.versionNumber, 2);

    // History records both approvals with the version each superseded.
    const reviews = await listDemoVersionReviews(ctx.db, demoId);
    assert.equal(reviews.length, 2);
    assert.equal(reviews[0]?.action, "approved");
    assert.equal(reviews[0]?.previousApprovedDemoVersionId, first.summary.demoVersionId);
    assert.equal(reviews[1]?.previousApprovedDemoVersionId, null);

    const events = await ctx.db
      .selectFrom("event")
      .select(["event_type", "properties"])
      .where("event_type", "in", ["demo_generated", "demo_regenerated", "demo_approved"])
      .orderBy("occurred_at")
      .execute();
    assert.equal(events.filter((event) => event.event_type === "demo_generated").length, 1);
    assert.equal(events.filter((event) => event.event_type === "demo_regenerated").length, 1);
    assert.equal(events.filter((event) => event.event_type === "demo_approved").length, 2);
  } finally {
    await ctx.destroy();
  }
});

test("critical QA failures block approval unless an operator records an audited override", async () => {
  const ctx = await createTestDatabase();
  try {
    const outcome = await seedQualifiedProspect(ctx, "Broken Roofing", "broken-roofing");
    const generated = await generateDemoForProspect(ctx.db, outcome.prospectId);
    assert.equal(generated.status, "generated");
    if (generated.status !== "generated") return;
    const { demoId, demoVersionId, locatorToken } = generated.summary;

    // No QA at all is itself a blocker.
    const withoutQa = await approveDemoVersion(ctx.db, { demoId, demoVersionId, actor: OPERATOR });
    assert.equal(withoutQa.status, "blocked");
    if (withoutQa.status !== "blocked") return;
    assert.equal(withoutQa.blockers[0]?.code, "QA_MISSING");

    const { evaluation } = await persistDemoQaResult(ctx.db, {
      report: qaReport(demoVersionId, locatorToken, ["no horizontal overflow", "services visible"]),
    });
    assert.equal(evaluation.status, "failed");
    assert.equal(evaluation.criticalFailures.length, 2, "overflow is critical on both viewports");
    assert.ok(evaluation.criticalFailures.every((failure) => failure.includes("no horizontal overflow")));

    const blocked = await approveDemoVersion(ctx.db, { demoId, demoVersionId, actor: OPERATOR });
    assert.equal(blocked.status, "blocked");
    if (blocked.status !== "blocked") return;
    assert.equal(blocked.blockers[0]?.code, "QA_CRITICAL_FAILURES");
    assert.equal(blocked.blockers[0]?.overridable, true);
    assert.equal(await getApprovedDemoVersion(ctx.db, demoId), undefined);

    const overridden = await approveDemoVersion(ctx.db, {
      demoId,
      demoVersionId,
      actor: OPERATOR,
      qaOverrideReason: "overflow is a QA harness artifact, verified by hand",
    });
    assert.equal(overridden.status, "approved");
    if (overridden.status !== "approved") return;
    assert.equal(overridden.summary.qaOverride, true);

    const reviews = await listDemoVersionReviews(ctx.db, demoId);
    assert.equal(reviews[0]?.qaOverride, true);
    assert.match(reviews[0]?.note ?? "", /verified by hand/);
    const override = await ctx.db
      .selectFrom("event")
      .select(["event_type", "properties"])
      .where("event_type", "=", "operator_override")
      .executeTakeFirst();
    assert.ok(override, "an override must be audited as an operator_override event");
  } finally {
    await ctx.destroy();
  }
});

test("only a version belonging to the demo can be approved", async () => {
  const ctx = await createTestDatabase();
  try {
    const a = await seedQualifiedProspect(ctx, "Alpha Roofing", "alpha-roofing", "+1 801 555 0150");
    const b = await seedQualifiedProspect(ctx, "Beta Roofing", "beta-roofing", "+1 801 555 0151");
    const demoA = await generateDemoForProspect(ctx.db, a.prospectId);
    const demoB = await generateDemoForProspect(ctx.db, b.prospectId);
    assert.equal(demoA.status, "generated");
    assert.equal(demoB.status, "generated");
    if (demoA.status !== "generated" || demoB.status !== "generated") return;

    const crossed = await approveDemoVersion(ctx.db, {
      demoId: demoA.summary.demoId,
      demoVersionId: demoB.summary.demoVersionId,
      actor: OPERATOR,
    });
    assert.equal(crossed.status, "blocked");
    if (crossed.status !== "blocked") return;
    assert.equal(crossed.blockers[0]?.code, "VERSION_NOT_IN_DEMO");

    const unknown = await approveDemoVersion(ctx.db, {
      demoId: demoA.summary.demoId,
      demoVersionId: "00000000-0000-0000-0000-000000000000",
      actor: OPERATOR,
    });
    assert.equal(unknown.status, "blocked");
    if (unknown.status !== "blocked") return;
    assert.equal(unknown.blockers[0]?.code, "VERSION_NOT_FOUND");
  } finally {
    await ctx.destroy();
  }
});

test("rejection is audited, and rejecting the approved version withdraws approval without promoting anything", async () => {
  const ctx = await createTestDatabase();
  try {
    const outcome = await seedQualifiedProspect(ctx, "Rejected Roofing", "rejected-roofing");
    const first = await generateDemoForProspect(ctx.db, outcome.prospectId);
    assert.equal(first.status, "generated");
    if (first.status !== "generated") return;
    await persistDemoQaResult(ctx.db, { report: qaReport(first.summary.demoVersionId, first.summary.locatorToken) });
    await approveDemoVersion(ctx.db, {
      demoId: first.summary.demoId,
      demoVersionId: first.summary.demoVersionId,
      actor: OPERATOR,
    });

    const second = await generateDemoForProspect(ctx.db, outcome.prospectId, { forceRegenerate: true });
    assert.equal(second.status, "generated");
    if (second.status !== "generated") return;

    // Rejecting the unapproved new version leaves approval alone.
    const rejectedNew = await rejectDemoVersion(ctx.db, {
      demoId: second.summary.demoId,
      demoVersionId: second.summary.demoVersionId,
      actor: OPERATOR,
      note: "hero photo is wrong",
    });
    assert.equal(rejectedNew.status, "rejected");
    if (rejectedNew.status !== "rejected") return;
    assert.equal(rejectedNew.approvalCleared, false);
    assert.equal(
      (await getApprovedDemoVersion(ctx.db, first.summary.demoId))?.demoVersionId,
      first.summary.demoVersionId,
    );

    // Rejecting the approved version withdraws it and promotes nothing.
    const rejectedApproved = await rejectDemoVersion(ctx.db, {
      demoId: first.summary.demoId,
      demoVersionId: first.summary.demoVersionId,
      actor: OPERATOR,
      note: "claim wording needs work",
    });
    assert.equal(rejectedApproved.status, "rejected");
    if (rejectedApproved.status !== "rejected") return;
    assert.equal(rejectedApproved.approvalCleared, true);
    assert.equal(await getApprovedDemoVersion(ctx.db, first.summary.demoId), undefined);
    assert.equal(
      await resolveDemoByLocator(ctx.db, first.summary.locatorToken, { mode: "public" }),
      undefined,
      "withdrawing approval takes the public demo offline",
    );

    const reviews = await listDemoVersionReviews(ctx.db, first.summary.demoId);
    assert.equal(reviews.filter((review) => review.action === "rejected").length, 2);
    assert.ok(reviews.some((review) => review.note === "hero photo is wrong"));
    const rejectedEvents = await ctx.db
      .selectFrom("event")
      .select("id")
      .where("event_type", "=", "demo_rejected")
      .execute();
    assert.equal(rejectedEvents.length, 2);
  } finally {
    await ctx.destroy();
  }
});

test("an actively suppressed business can never be approved or become ready for outreach", async () => {
  const ctx = await createTestDatabase();
  try {
    const outcome = await seedQualifiedProspect(ctx, "Suppressed Roofing", "suppressed-roofing");
    const generated = await generateDemoForProspect(ctx.db, outcome.prospectId);
    assert.equal(generated.status, "generated");
    if (generated.status !== "generated") return;
    await persistDemoQaResult(ctx.db, {
      report: qaReport(generated.summary.demoVersionId, generated.summary.locatorToken),
    });

    await activateSuppression(ctx.db, {
      scope: "business",
      businessId: outcome.businessId,
      suppressionType: "do_not_contact",
      reason: "Owner asked never to be contacted.",
      actorType: "operator",
      actorRef: "test-operator",
    });

    const blocked = await approveDemoVersion(ctx.db, {
      demoId: generated.summary.demoId,
      demoVersionId: generated.summary.demoVersionId,
      actor: OPERATOR,
    });
    assert.equal(blocked.status, "blocked");
    if (blocked.status !== "blocked") return;
    assert.equal(blocked.blockers[0]?.code, "ACTIVELY_SUPPRESSED");
    assert.equal(blocked.blockers[0]?.overridable, false, "suppression is never overridable from the admin");

    const view = await getProspectDemoView(ctx.db, outcome.prospectId);
    assert.equal(view?.readiness.suppressed, true);
    assert.equal(view?.readiness.readyForOutreach, false);
  } finally {
    await ctx.destroy();
  }
});
