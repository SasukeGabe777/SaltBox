import { createHash } from "node:crypto";
import type { Database } from "@saltbox/database/client";
import { appendEvent, type AppendEventInput } from "@saltbox/database/repositories/events";
import {
  BODY_TEMPLATE_VERSION,
  CAMPAIGN_NAME,
  OUTREACH_CONTENT_VERSION,
  OUTREACH_POLICY_VERSION,
  SENDER_PROFILE_VERSION,
  SEQUENCE_DEFINITION,
  SEQUENCE_NAME,
  SEQUENCE_VERSION,
  SUBJECT_TEMPLATE_VERSION,
  senderProfile,
  type SenderProfile,
} from "./config.ts";
import { checkOutreachEligibility } from "./eligibility.ts";
import { renderOutreachMessage, selectSupportedObservation } from "./message.ts";
import type { OutreachEligibilityResult, PreparedAgainst } from "./types.ts";

export interface PreparedMessageRecord {
  messageId: string;
  status: "send_ready";
  reused: boolean;
  to: string;
  subject: string;
  body: string;
  preparedAt: string;
  campaignName: string;
  campaignVersion: string;
  sequenceName: string;
  sequenceVersion: number;
  sequenceStep: 1;
  contentVersion: string;
  subjectTemplateVersion: string;
  bodyTemplateVersion: string;
  demoVersionId: string;
  demoVersionNumber: number;
  demoUrl: string;
  sender: SenderProfile;
  providerAttemptCount: 0;
}

export type PrepareOutreachResult =
  | { status: "send_ready"; eligibility: OutreachEligibilityResult; message: PreparedMessageRecord }
  | { status: "ineligible"; eligibility: OutreachEligibilityResult; message: null };

interface CampaignConfig {
  campaignId: string;
  sequenceVersionId: string;
}

export async function prepareOutreach(
  db: Database,
  input: { prospectId: string; actorRef: string; sender?: SenderProfile },
): Promise<PrepareOutreachResult> {
  const sender = input.sender ?? senderProfile();
  return db.transaction().execute(async (trx) => {
    const config = await ensureCampaignConfiguration(trx);
    const eligibility = await checkOutreachEligibility(trx, input.prospectId, { lockDemo: true });
    if (!eligibility.eligible || !eligibility.businessId || !eligibility.businessName || !eligibility.contact || !eligibility.artifact) {
      await recordEligibilityCheck(trx, eligibility, config.campaignId, input.actorRef, "prepare-blocked");
      return { status: "ineligible", eligibility, message: null };
    }

    const idempotencyKey = preparationKey({
      prospectId: input.prospectId,
      sequenceVersionId: config.sequenceVersionId,
      contactMethodId: eligibility.contact.contactMethodId,
      demoVersionId: eligibility.artifact.demoVersionId,
    });
    const existing = await trx
      .selectFrom("message")
      .selectAll()
      .where("channel", "=", "email")
      .where("idempotency_key", "=", idempotencyKey)
      .executeTakeFirst();
    if (existing?.status === "send_ready") {
      const prepared = preparedAgainst(existing);
      if (prepared) {
        const live = await checkOutreachEligibility(trx, input.prospectId, { preparedAgainst: prepared, lockDemo: true });
        await recordEligibilityCheck(trx, live, config.campaignId, input.actorRef, `reuse:${existing.id}`);
        if (live.eligible && live.contact && live.artifact && existing.subject && existing.body && existing.prepared_at) {
          return {
            status: "send_ready",
            eligibility: live,
            message: mapPreparedMessage(existing, live.contact.email, live.artifact.demoVersionNumber, sender, true),
          };
        }
      }
    }

    const enrollment = await ensureEnrollment(trx, {
      prospectId: input.prospectId,
      campaignId: config.campaignId,
      sequenceVersionId: config.sequenceVersionId,
    });
    const observation = await selectSupportedObservation(trx, eligibility.businessId);
    const rendered = renderOutreachMessage({
      businessName: eligibility.businessName,
      category: eligibility.category,
      city: eligibility.city,
      state: eligibility.state,
      demoUrl: eligibility.artifact.hostedUrl,
      contact: eligibility.contact,
      observation,
      sender,
    });
    const now = new Date();

    await trx
      .updateTable("message")
      .set({ status: "cancelled", invalidated_at: now })
      .where("prospect_id", "=", input.prospectId)
      .where("direction", "=", "outbound")
      .where("channel", "=", "email")
      .where("status", "in", ["prepared", "send_ready"])
      .where("demo_version_id", "!=", eligibility.artifact.demoVersionId)
      .execute();

    const inserted = await trx
      .insertInto("message")
      .values({
        direction: "outbound",
        channel: "email",
        business_id: eligibility.businessId,
        prospect_id: input.prospectId,
        contact_id: eligibility.contact.contactId,
        contact_method_id: eligibility.contact.contactMethodId,
        campaign_enrollment_id: enrollment.id,
        sequence_step: 1,
        template_ref: BODY_TEMPLATE_VERSION,
        content_version: OUTREACH_CONTENT_VERSION,
        subject: rendered.subject,
        body: rendered.body,
        idempotency_key: idempotencyKey,
        status: "prepared",
        demo_id: eligibility.artifact.demoId,
        demo_version_id: eligibility.artifact.demoVersionId,
        demo_public_locator_id: eligibility.artifact.publicLocatorId,
        demo_approval_review_id: eligibility.artifact.approvalReviewId,
        hosted_publication_id: eligibility.artifact.hostedPublicationId,
        approved_at_snapshot: new Date(eligibility.artifact.approvedAt),
        public_url: eligibility.artifact.hostedUrl,
        selected_contact_reason: eligibility.contact.selectionReason,
        selected_contact_source_ref: eligibility.contact.sourceRef,
        selected_contact_confidence: eligibility.contact.confidence,
        sender_profile_version: sender.version,
        subject_template_version: rendered.subjectTemplateVersion,
        body_template_version: rendered.bodyTemplateVersion,
        preparation_metadata: JSON.stringify({
          schemaVersion: 1,
          policyVersion: OUTREACH_POLICY_VERSION,
          contactSelection: {
            reason: eligibility.contact.selectionReason,
            sourceKind: eligibility.contact.sourceKind,
            sourceRef: eligibility.contact.sourceRef,
            validationStatus: eligibility.contact.validationStatus,
            syntaxValid: eligibility.contact.validation.syntaxValid,
            dnsChecked: false,
            mxChecked: false,
            mailboxConfirmed: false,
          },
          observation,
          senderRequirements: sender.phase12Requirements,
          noSend: true,
        }),
        prepared_at: now,
      })
      .onConflict((oc) => oc.columns(["channel", "idempotency_key"]).doNothing())
      .returningAll()
      .executeTakeFirst();

    const intent = inserted ?? (await trx.selectFrom("message").selectAll().where("channel", "=", "email").where("idempotency_key", "=", idempotencyKey).executeTakeFirstOrThrow());
    const pinned = preparedAgainst(intent);
    if (!pinned) throw new Error("Prepared outreach intent did not persist every required artifact pin.");
    const finalEligibility = await checkOutreachEligibility(trx, input.prospectId, { preparedAgainst: pinned, lockDemo: true });
    await recordEligibilityCheck(trx, finalEligibility, config.campaignId, input.actorRef, `final:${intent.id}`);
    if (!finalEligibility.eligible || !finalEligibility.contact || !finalEligibility.artifact) {
      await trx.updateTable("message").set({ status: "cancelled", invalidated_at: new Date() }).where("id", "=", intent.id).execute();
      return { status: "ineligible", eligibility: finalEligibility, message: null };
    }

    const readyAt = new Date();
    const ready = await trx
      .updateTable("message")
      .set({ status: "send_ready", send_ready_at: readyAt })
      .where("id", "=", intent.id)
      .where("status", "=", "prepared")
      .returningAll()
      .executeTakeFirst();
    const finalMessage = ready ?? (await trx.selectFrom("message").selectAll().where("id", "=", intent.id).executeTakeFirstOrThrow());
    if (finalMessage.status !== "send_ready") throw new Error("Outreach intent failed to enter SEND-READY.");

    if (inserted) {
      await appendEvent(trx, eventInput("message_intent_created", intent.id, eligibility, config.campaignId, input.actorRef));
      await appendEvent(trx, eventInput("outreach_prepared", intent.id, eligibility, config.campaignId, input.actorRef));
      await appendEvent(trx, eventInput("message_send_ready", intent.id, eligibility, config.campaignId, input.actorRef));
    }
    return {
      status: "send_ready",
      eligibility: finalEligibility,
      message: mapPreparedMessage(finalMessage, finalEligibility.contact.email, finalEligibility.artifact.demoVersionNumber, sender, !inserted),
    };
  });
}

export async function ensureCampaignConfiguration(db: Database): Promise<CampaignConfig> {
  const campaignInsert = await db
    .insertInto("outreach_campaign")
    .values({
      name: CAMPAIGN_NAME,
      strategy: "Short, deterministic proof-first email linking the exact approved hosted demo.",
      audience: "Qualified local-service prospects with approved hosted demos and eligible persisted email contacts.",
      offer: "A completed website concept; no obligation and no fabricated claims.",
      policy_version: OUTREACH_POLICY_VERSION,
      status: "draft",
    })
    .onConflict((oc) => oc.column("name").doNothing())
    .returning("id")
    .executeTakeFirst();
  const campaign = campaignInsert
    ? await db.selectFrom("outreach_campaign").select(["id", "policy_version"]).where("id", "=", campaignInsert.id).executeTakeFirstOrThrow()
    : await db.selectFrom("outreach_campaign").select(["id", "policy_version"]).where("name", "=", CAMPAIGN_NAME).executeTakeFirstOrThrow();
  if (campaign.policy_version !== OUTREACH_POLICY_VERSION) throw new Error("The versioned outreach campaign differs from committed policy.");
  const campaignId = campaign.id;
  const sequenceInsert = await db
    .insertInto("outreach_sequence")
    .values({ outreach_campaign_id: campaignId, name: SEQUENCE_NAME })
    .onConflict((oc) => oc.columns(["outreach_campaign_id", "name"]).doNothing())
    .returning("id")
    .executeTakeFirst();
  const sequenceId = sequenceInsert?.id ?? (await db.selectFrom("outreach_sequence").select("id").where("outreach_campaign_id", "=", campaignId).where("name", "=", SEQUENCE_NAME).executeTakeFirstOrThrow()).id;
  const versionInsert = await db
    .insertInto("outreach_sequence_version")
    .values({ outreach_sequence_id: sequenceId, version: SEQUENCE_VERSION, definition: JSON.stringify(SEQUENCE_DEFINITION) })
    .onConflict((oc) => oc.columns(["outreach_sequence_id", "version"]).doNothing())
    .returning("id")
    .executeTakeFirst();
  const version = versionInsert ?? (await db.selectFrom("outreach_sequence_version").select(["id", "definition"]).where("outreach_sequence_id", "=", sequenceId).where("version", "=", SEQUENCE_VERSION).executeTakeFirstOrThrow());
  if (!sameJson("definition" in version ? version.definition : SEQUENCE_DEFINITION, SEQUENCE_DEFINITION)) {
    throw new Error("The immutable saltbox-demo-outreach-v1 sequence definition differs from committed configuration.");
  }
  return { campaignId, sequenceVersionId: version.id };
}

async function ensureEnrollment(db: Database, input: { prospectId: string; campaignId: string; sequenceVersionId: string }) {
  const existing = await db.selectFrom("campaign_enrollment").selectAll().where("prospect_id", "=", input.prospectId).where("outreach_campaign_id", "=", input.campaignId).where("status", "=", "active").executeTakeFirst();
  if (existing) {
    if (existing.outreach_sequence_version_id !== input.sequenceVersionId) throw new Error("Active campaign enrollment is pinned to another immutable sequence version.");
    return existing;
  }
  const inserted = await db.insertInto("campaign_enrollment").values({ prospect_id: input.prospectId, outreach_campaign_id: input.campaignId, outreach_sequence_version_id: input.sequenceVersionId, status: "active" }).onConflict((oc) => oc.doNothing()).returningAll().executeTakeFirst();
  const resolved = inserted ?? await db.selectFrom("campaign_enrollment").selectAll().where("prospect_id", "=", input.prospectId).where("outreach_campaign_id", "=", input.campaignId).where("status", "=", "active").executeTakeFirstOrThrow();
  if (resolved.outreach_sequence_version_id !== input.sequenceVersionId) throw new Error("Active campaign enrollment is pinned to another immutable sequence version.");
  return resolved;
}

function preparationKey(input: { prospectId: string; sequenceVersionId: string; contactMethodId: string; demoVersionId: string }): string {
  const digest = createHash("sha256").update([input.prospectId, input.sequenceVersionId, "step:1", input.contactMethodId, input.demoVersionId].join("|")).digest("hex");
  return `saltbox-demo-outreach-v1:${digest}`;
}

function preparedAgainst(row: { id: string; idempotency_key: string; contact_method_id: string | null; demo_version_id: string | null; demo_public_locator_id: string | null; demo_approval_review_id: string | null; approved_at_snapshot: Date | string | null; hosted_publication_id: string | null }): PreparedAgainst | null {
  if (!row.contact_method_id || !row.demo_version_id || !row.demo_public_locator_id || !row.demo_approval_review_id || !row.approved_at_snapshot || !row.hosted_publication_id) return null;
  return { messageId: row.id, idempotencyKey: row.idempotency_key, contactMethodId: row.contact_method_id, demoVersionId: row.demo_version_id, publicLocatorId: row.demo_public_locator_id, approvalReviewId: row.demo_approval_review_id, approvedAt: iso(row.approved_at_snapshot), hostedPublicationId: row.hosted_publication_id };
}

function mapPreparedMessage(row: { id: string; status: string; subject: string | null; body: string | null; prepared_at: Date | string | null; public_url: string | null; demo_version_id: string | null; content_version: string | null; subject_template_version: string | null; body_template_version: string | null }, to: string, demoVersionNumber: number, sender: SenderProfile, reused: boolean): PreparedMessageRecord {
  if (row.status !== "send_ready" || !row.subject || !row.body || !row.prepared_at || !row.public_url || !row.demo_version_id) throw new Error("Incomplete SEND-READY message record.");
  return { messageId: row.id, status: "send_ready", reused, to, subject: row.subject, body: row.body, preparedAt: iso(row.prepared_at), campaignName: CAMPAIGN_NAME, campaignVersion: OUTREACH_POLICY_VERSION, sequenceName: SEQUENCE_NAME, sequenceVersion: SEQUENCE_VERSION, sequenceStep: 1, contentVersion: row.content_version ?? OUTREACH_CONTENT_VERSION, subjectTemplateVersion: row.subject_template_version ?? SUBJECT_TEMPLATE_VERSION, bodyTemplateVersion: row.body_template_version ?? BODY_TEMPLATE_VERSION, demoVersionId: row.demo_version_id, demoVersionNumber, demoUrl: row.public_url, sender, providerAttemptCount: 0 };
}

function eventInput(eventType: "message_intent_created" | "outreach_prepared" | "message_send_ready", messageId: string, eligibility: OutreachEligibilityResult, campaignId: string, actorRef: string): AppendEventInput {
  return { category: "domain", eventType, occurredAt: new Date(), sourceProducer: "outreach-foundations-v1", actorType: "operator", actorRef, ...(eligibility.businessId ? { businessId: eligibility.businessId } : {}), prospectId: eligibility.prospectId, ...(eligibility.artifact ? { demoVersionId: eligibility.artifact.demoVersionId } : {}), messageId, outreachCampaignId: campaignId, idempotencyScope: "outreach-message-lifecycle", idempotencyKey: `${messageId}:${eventType}`, properties: { policyVersion: OUTREACH_POLICY_VERSION, noSend: true } };
}

async function recordEligibilityCheck(db: Database, eligibility: OutreachEligibilityResult, campaignId: string, actorRef: string, key: string): Promise<void> {
  await appendEvent(db, { category: "audit", eventType: "outreach_eligibility_checked", occurredAt: new Date(), sourceProducer: "outreach-foundations-v1", actorType: "operator", actorRef, ...(eligibility.businessId ? { businessId: eligibility.businessId } : {}), prospectId: eligibility.prospectId, ...(eligibility.artifact ? { demoVersionId: eligibility.artifact.demoVersionId } : {}), outreachCampaignId: campaignId, idempotencyScope: "outreach-eligibility-check", idempotencyKey: `${eligibility.prospectId}:${key}`, properties: { eligible: eligibility.eligible, reasonCodes: eligibility.reasons.map((reason) => reason.code), policyVersion: OUTREACH_POLICY_VERSION } });
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(sort(left)) === JSON.stringify(sort(right));
}

function sort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, sort(nested)]));
  return value;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
