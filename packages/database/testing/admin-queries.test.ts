import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createBusiness } from "../repositories/businesses.ts";
import { createDecision } from "../repositories/decisions.ts";
import { createFeatureSet } from "../repositories/features.ts";
import { recordObservation } from "../repositories/observations.ts";
import { openProspect, transitionProspect, type ProspectRecord } from "../repositories/prospects.ts";
import { createLeadScore, ensureScoringVersion } from "../repositories/scoring.ts";
import { ensureSource, linkSourceRecordToBusiness, upsertSourceRecord } from "../repositories/sources.ts";
import {
  ensureBusinessWebsite,
  ensureDomain,
  recordWebsiteAnalysis,
  recordWebsiteSnapshot,
} from "../repositories/websites.ts";
import {
  getDashboardSummary,
  getProspectDetail,
  getRecentActivity,
  listProspects,
} from "../queries/admin.ts";
import { createTestDatabase, type TestDatabase } from "./harness.ts";

let ctx: TestDatabase;
let qualifiedProspectId: string;
let rejectedProspectId: string;

before(async () => {
  ctx = await createTestDatabase();
  const rejected = await seedProspect({
    name: "Golden Crumb Bakery",
    externalId: "admin-bakery-001",
    category: "bakery",
    result: "rejected",
    scores: [52],
  });
  rejectedProspectId = rejected.id;

  const qualified = await seedProspect({
    name: "Summit Ridge Roofing",
    externalId: "admin-roofing-001",
    category: "roofing",
    result: "qualified",
    scores: [61, 88],
  });
  qualifiedProspectId = qualified.id;
});

after(async () => {
  await ctx.destroy();
});

test("listProspects selects the latest score and applies operator filters", async () => {
  const rows = await listProspects(ctx.db);
  assert.equal(rows.length, 2);
  const roofing = rows.find((row) => row.prospectId === qualifiedProspectId)!;
  assert.equal(roofing.overallScore, 88);
  assert.equal(roofing.decision, "qualified");
  assert.equal(roofing.sourceName, "admin_fixture");

  assert.deepEqual((await listProspects(ctx.db, { status: "rejected" })).map((row) => row.prospectId), [rejectedProspectId]);
  assert.deepEqual((await listProspects(ctx.db, { search: "summit", minimumScore: 80 })).map((row) => row.prospectId), [qualifiedProspectId]);
  assert.deepEqual((await listProspects(ctx.db, { source: "admin_fixture", category: "roofing" })).map((row) => row.prospectId), [qualifiedProspectId]);
  assert.deepEqual(await listProspects(ctx.db, { search: "does-not-exist" }), []);
});

test("dashboard summary and activity distinguish qualified and rejected persisted records", async () => {
  assert.deepEqual(await getDashboardSummary(ctx.db), { total: 2, qualified: 1, rejected: 1, analyzed: 2 });
  const activity = await getRecentActivity(ctx.db, 40);
  assert.ok(activity.some((entry) => entry.prospectId === qualifiedProspectId && entry.label === "Prospect qualified"));
  assert.ok(activity.some((entry) => entry.prospectId === rejectedProspectId && entry.label === "Prospect rejected"));
  assert.ok(activity.every((entry) => entry.source === "persisted_record"));
});

test("prospect detail preserves historical scores and selects the latest run", async () => {
  const detail = await getProspectDetail(ctx.db, qualifiedProspectId);
  assert.ok(detail);
  assert.equal(detail.currentScoreId, detail.scoreHistory[0]!.id);
  assert.deepEqual(detail.scoreHistory.map((run) => run.overallScore), [88, 61]);
  assert.equal(detail.scoreHistory[0]!.isLatest, true);
  assert.equal(detail.scoreHistory[1]!.isLatest, false);
  assert.equal(detail.scoreHistory[0]!.decisions[0]!.result, "qualified");
  assert.ok(detail.scoreHistory[0]!.decisions[0]!.reasons.some((reason) => reason.code === "SCORE_ABOVE_THRESHOLD"));
  assert.equal(detail.scoreHistory[0]!.websiteAnalysis?.httpStatus, 200);
  assert.equal(detail.scoreHistory[0]!.websiteAnalysis?.signals?.viewportPresent, false);
});

test("prospect detail returns typed observations and source provenance", async () => {
  const detail = await getProspectDetail(ctx.db, qualifiedProspectId);
  assert.ok(detail);
  const email = detail.observations.find((observation) => observation.field === "email_available");
  assert.equal(email?.value, true);
  assert.equal(email?.sourceName, "admin_fixture");
  assert.equal(detail.provenance[0]?.externalId, "admin-roofing-001");
  assert.equal(detail.provenance[0]?.sourceName, "admin_fixture");
});

test("prospect detail isolates shared-website evidence by FeatureSet lineage", async () => {
  const alpha = await seedSharedWebsiteRun({
    name: "Shared Identity Alpha",
    externalId: "shared-alpha",
    requestedUrl: "http://shared-identity.example:5101/alpha",
    analyzerVersion: "shared-alpha-analyzer",
    observationField: "shared_alpha_signal",
    score: 81,
  });
  const beta = await seedSharedWebsiteRun({
    name: "Shared Identity Beta",
    externalId: "shared-beta",
    requestedUrl: "http://shared-identity.example:5102/beta",
    analyzerVersion: "shared-beta-analyzer",
    observationField: "shared_beta_signal",
    score: 42,
  });

  assert.equal(alpha.websiteId, beta.websiteId, "the regression setup must share one normalized Website");

  const alphaDetail = await getProspectDetail(ctx.db, alpha.prospectId);
  const betaDetail = await getProspectDetail(ctx.db, beta.prospectId);
  assert.ok(alphaDetail);
  assert.ok(betaDetail);

  assert.deepEqual(alphaDetail.scoreHistory.map((run) => run.featureSetId), [alpha.featureSetId]);
  assert.equal(alphaDetail.scoreHistory[0]?.websiteAnalysis?.featureSetId, alpha.featureSetId);
  assert.equal(alphaDetail.scoreHistory[0]?.websiteAnalysis?.id, alpha.analysisId);
  assert.equal(alphaDetail.scoreHistory[0]?.websiteAnalysis?.requestedUrl, alpha.requestedUrl);
  assert.deepEqual(alphaDetail.observations.map((observation) => observation.id), [alpha.observationId]);

  assert.deepEqual(betaDetail.scoreHistory.map((run) => run.featureSetId), [beta.featureSetId]);
  assert.equal(betaDetail.scoreHistory[0]?.websiteAnalysis?.featureSetId, beta.featureSetId);
  assert.equal(betaDetail.scoreHistory[0]?.websiteAnalysis?.id, beta.analysisId);
  assert.equal(betaDetail.scoreHistory[0]?.websiteAnalysis?.requestedUrl, beta.requestedUrl);
  assert.deepEqual(betaDetail.observations.map((observation) => observation.id), [beta.observationId]);

  assert.notEqual(alphaDetail.scoreHistory[0]?.websiteAnalysis?.id, beta.analysisId);
  assert.notEqual(alphaDetail.scoreHistory[0]?.websiteAnalysis?.requestedUrl, beta.requestedUrl);
  assert.ok(!alphaDetail.observations.some((observation) => observation.id === beta.observationId));
});

test("prospect timeline is chronological and includes the terminal decision", async () => {
  const detail = await getProspectDetail(ctx.db, rejectedProspectId);
  assert.ok(detail);
  assert.deepEqual(detail.timeline.map((entry) => entry.toState), ["discovered", "enriching", "evaluated", "rejected"]);
  assert.equal(detail.scoreHistory[0]!.overallScore, 52);
  assert.equal(detail.scoreHistory[0]!.decisions[0]!.result, "rejected");
});

test("getProspectDetail returns undefined for a missing prospect", async () => {
  assert.equal(await getProspectDetail(ctx.db, "00000000-0000-0000-0000-000000000000"), undefined);
});

async function seedSharedWebsiteRun(input: {
  name: string;
  externalId: string;
  requestedUrl: string;
  analyzerVersion: string;
  observationField: string;
  score: number;
}) {
  const sourceId = await ensureSource(ctx.db, { name: "shared_website_fixture", sourceType: "manual" });
  const sourceRecord = await upsertSourceRecord(ctx.db, { sourceId, externalId: input.externalId });
  const business = await createBusiness(ctx.db, { canonicalName: input.name, category: "shared-test" });
  await linkSourceRecordToBusiness(ctx.db, sourceRecord.id, business.id);

  const domainId = await ensureDomain(ctx.db, "shared-identity.example");
  const websiteId = await ensureBusinessWebsite(ctx.db, {
    businessId: business.id,
    domainId,
    canonicalUrl: input.requestedUrl,
  });
  const prospect = await openProspect(ctx.db, {
    businessId: business.id,
    actorType: "system",
    reasonCode: "prospecting.discovered",
  });
  const observationId = await recordObservation(ctx.db, {
    subjectKind: "website",
    subjectId: websiteId,
    fieldKey: input.observationField,
    value: { kind: "boolean", value: true },
    sourceId,
    sourceRecordId: sourceRecord.id,
    observedAt: new Date(),
    confidence: "verified",
  });
  const snapshotId = await recordWebsiteSnapshot(ctx.db, {
    websiteId,
    requestedUrl: input.requestedUrl,
    finalUrl: input.requestedUrl,
    httpStatus: 200,
    httpsOk: false,
    observedAt: new Date(),
    captureToolVersion: "shared-website-regression",
  });
  const analysisId = await recordWebsiteAnalysis(ctx.db, {
    websiteId,
    analyzerVersion: input.analyzerVersion,
    findingsSchemaVersion: 1,
    structuredFindings: {
      reachable: true,
      httpStatus: 200,
      https: false,
      latencyMs: input.score,
      htmlRetrieved: true,
      redirectChain: [],
      signals: null,
      failure: null,
    },
    snapshotIds: [snapshotId],
  });
  const featureSetId = await createFeatureSet(ctx.db, {
    prospectId: prospect.id,
    featureSchemaVersion: "prospect-qualification-features-v1",
    pipelineVersion: "prospecting-pipeline-v1",
    asOf: new Date(),
    values: [],
    lineage: [
      { inputKind: "observation", inputId: observationId },
      { inputKind: "website_analysis", inputId: analysisId },
    ],
  });
  const scoringVersionId = await ensureScoringVersion(ctx.db, {
    name: "qualification-v1",
    inputSchemaVersion: "prospect-qualification-features-v1",
    artifactVersion: "1.0.0",
  });
  await createLeadScore(ctx.db, {
    prospectId: prospect.id,
    featureSetId,
    scoringVersionId,
    overallScore: input.score,
    components: [],
  });

  return {
    prospectId: prospect.id,
    websiteId,
    observationId,
    snapshotId,
    analysisId,
    featureSetId,
    requestedUrl: input.requestedUrl,
  };
}

async function seedProspect(input: {
  name: string;
  externalId: string;
  category: string;
  result: "qualified" | "rejected";
  scores: number[];
}): Promise<ProspectRecord> {
  const sourceId = await ensureSource(ctx.db, { name: "admin_fixture", sourceType: "manual" });
  const sourceRecord = await upsertSourceRecord(ctx.db, {
    sourceId,
    externalId: input.externalId,
    providerMetadata: { city: "Ogden", state: "UT" },
  });
  const business = await createBusiness(ctx.db, { canonicalName: input.name, category: input.category });
  await linkSourceRecordToBusiness(ctx.db, sourceRecord.id, business.id);

  const observationId = await recordObservation(ctx.db, {
    subjectKind: "business",
    subjectId: business.id,
    fieldKey: "email_available",
    value: { kind: "boolean", value: true },
    sourceId,
    sourceRecordId: sourceRecord.id,
    observedAt: new Date(),
    confidence: "verified",
  });

  const domainId = await ensureDomain(ctx.db, `${input.externalId}.example`);
  const websiteId = await ensureBusinessWebsite(ctx.db, {
    businessId: business.id,
    domainId,
    canonicalUrl: `https://${input.externalId}.example/`,
  });
  const prospect = await openProspect(ctx.db, {
    businessId: business.id,
    actorType: "system",
    reasonCode: "prospecting.discovered",
  });

  const scoringVersionId = await ensureScoringVersion(ctx.db, {
    name: "qualification-v1",
    inputSchemaVersion: "prospect-qualification-features-v1",
    artifactVersion: "1.0.0",
  });

  let latestDecisionId = "";
  for (const score of input.scores) {
    const snapshotId = await recordWebsiteSnapshot(ctx.db, {
      websiteId,
      requestedUrl: `https://${input.externalId}.example/`,
      finalUrl: `https://${input.externalId}.example/`,
      httpStatus: 200,
      httpsOk: true,
      observedAt: new Date(),
      captureToolVersion: "deterministic-website-analyzer-v1",
    });
    const analysisId = await recordWebsiteAnalysis(ctx.db, {
      websiteId,
      analyzerVersion: "deterministic-website-analyzer-v1",
      findingsSchemaVersion: 1,
      structuredFindings: {
        reachable: true,
        httpStatus: 200,
        https: true,
        latencyMs: 18,
        htmlRetrieved: true,
        redirectChain: [],
        signals: {
          titlePresent: true,
          metaDescriptionPresent: false,
          viewportPresent: false,
          contactFormPresent: false,
          ctaPresent: false,
          emailPresent: true,
          phonePresent: true,
          copyrightYear: 2026,
        },
        failure: null,
      },
      snapshotIds: [snapshotId],
    });
    const featureSetId = await createFeatureSet(ctx.db, {
      prospectId: prospect.id,
      featureSchemaVersion: "prospect-qualification-features-v1",
      pipelineVersion: "prospecting-pipeline-v1",
      asOf: new Date(),
      stable: { businessCategory: input.category, emailAvailable: true, mobilePass: false },
      values: [],
      lineage: [
        { inputKind: "observation", inputId: observationId },
        { inputKind: "website_analysis", inputId: analysisId },
      ],
    });
    const leadScoreId = await createLeadScore(ctx.db, {
      prospectId: prospect.id,
      featureSetId,
      scoringVersionId,
      overallScore: score,
      needScore: input.category === "roofing" ? 80 : 15,
      valueScore: input.category === "roofing" ? 80 : 30,
      activityScore: 100,
      reachabilityScore: 100,
      components: [
        { dimension: "need", componentKey: "viewport_missing", result: 20, direction: "positive", reasonCode: "MOBILE_VIEWPORT_MISSING" },
      ],
    });
    latestDecisionId = await createDecision(ctx.db, {
      decisionType: input.result === "qualified" ? "qualify" : "reject",
      resultCode: input.result,
      resultDetail: { summary: `${input.result} test record` },
      policyVersion: "qualification-policy-v1",
      actorType: "system",
      businessId: business.id,
      prospectId: prospect.id,
      featureSetId,
      leadScoreId,
      reasons: [
        { reasonCode: "MOBILE_VIEWPORT_MISSING", contribution: "supports", explanation: "no mobile viewport configuration" },
        {
          reasonCode: input.result === "qualified" ? "SCORE_ABOVE_THRESHOLD" : "SCORE_BELOW_THRESHOLD",
          contribution: input.result === "qualified" ? "supports" : "opposes",
          explanation: "score compared with provisional threshold",
        },
      ],
    });
  }

  let revision = prospect.revision;
  revision = (await transitionProspect(ctx.db, {
    prospectId: prospect.id,
    expectedRevision: revision,
    toState: "enriching",
    reasonCode: "enrichment.started",
    actorType: "system",
  })).revision;
  revision = (await transitionProspect(ctx.db, {
    prospectId: prospect.id,
    expectedRevision: revision,
    toState: "evaluated",
    reasonCode: "analysis.complete",
    actorType: "system",
  })).revision;
  await transitionProspect(ctx.db, {
    prospectId: prospect.id,
    expectedRevision: revision,
    toState: input.result,
    reasonCode: `decision.${input.result}`,
    decisionId: latestDecisionId,
    actorType: "system",
  });

  return prospect;
}
