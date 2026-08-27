import type { Database } from "@saltbox/database/client";
import { checkOutreachEligibility } from "./eligibility.ts";
import { CAMPAIGN_NAME, OUTREACH_POLICY_VERSION, SEQUENCE_NAME, SEQUENCE_VERSION, senderProfile } from "./config.ts";
import type { OutreachEligibilityResult, OutreachQueueStatus, PreparedAgainst } from "./types.ts";

export interface OutreachMessageView {
  messageId: string;
  persistedStatus: string;
  liveEligible: boolean;
  stale: boolean;
  to: string;
  contactMethodId: string;
  contactName: string | null;
  contactSelectionReason: string;
  contactSourceRef: string;
  contactConfidence: string;
  subject: string;
  body: string;
  preparedAt: string;
  sendReadyAt: string | null;
  campaignName: string;
  campaignVersion: string;
  sequenceName: string;
  sequenceVersion: number;
  sequenceStep: number;
  contentVersion: string;
  subjectTemplateVersion: string;
  bodyTemplateVersion: string;
  senderProfileVersion: string;
  demoVersionId: string;
  demoVersionNumber: number;
  demoUrl: string;
  providerAttemptCount: number;
  deliveryStatus: "not_sent" | "sent" | "failed";
}

export interface ProspectOutreachView {
  prospectId: string;
  businessId: string | null;
  businessName: string | null;
  fitScore: number | null;
  status: OutreachQueueStatus;
  eligibility: OutreachEligibilityResult;
  message: OutreachMessageView | null;
  campaign: { name: string; version: string };
  sequence: { name: string; version: number };
  senderRequirements: string[];
  sendingEnabled: false;
}

export interface OutreachQueueItem {
  prospectId: string;
  businessName: string;
  fitScore: number | null;
  status: OutreachQueueStatus;
  contact: string | null;
  demoVersionNumber: number | null;
  messageId: string | null;
  preparedAt: string | null;
  reasonCodes: string[];
}

export async function getProspectOutreachView(db: Database, prospectId: string): Promise<ProspectOutreachView> {
  const row = await db
    .selectFrom("message as m")
    .leftJoin("contact_method as cm", "cm.id", "m.contact_method_id")
    .leftJoin("contact as c", "c.id", "m.contact_id")
    .leftJoin("campaign_enrollment as ce", "ce.id", "m.campaign_enrollment_id")
    .leftJoin("outreach_campaign as oc", "oc.id", "ce.outreach_campaign_id")
    .leftJoin("outreach_sequence_version as osv", "osv.id", "ce.outreach_sequence_version_id")
    .leftJoin("outreach_sequence as os", "os.id", "osv.outreach_sequence_id")
    .leftJoin("demo_version as dv", "dv.id", "m.demo_version_id")
    .select([
      "m.id", "m.status", "m.idempotency_key", "m.contact_method_id", "m.demo_version_id",
      "m.demo_public_locator_id", "m.demo_approval_review_id", "m.approved_at_snapshot",
      "m.hosted_publication_id", "m.subject", "m.body", "m.prepared_at", "m.send_ready_at",
      "m.public_url", "m.selected_contact_reason", "m.selected_contact_source_ref",
      "m.selected_contact_confidence", "m.content_version", "m.subject_template_version",
      "m.body_template_version", "m.sender_profile_version", "m.sequence_step",
      "cm.display_value", "cm.normalized_value", "c.full_name", "oc.name as campaign_name",
      "oc.policy_version", "os.name as sequence_name", "osv.version as sequence_version",
      "dv.version_number as demo_version_number",
    ])
    .where("m.prospect_id", "=", prospectId)
    .where("m.direction", "=", "outbound")
    .where("m.channel", "=", "email")
    .orderBy("m.created_at", "desc")
    .orderBy("m.id", "desc")
    .limit(1)
    .executeTakeFirst();

  const pinned = row ? preparedAgainst(row) : null;
  const eligibility = await checkOutreachEligibility(db, prospectId, pinned ? { preparedAgainst: pinned } : {});
  let message: OutreachMessageView | null = null;
  if (
    row && row.contact_method_id && row.demo_version_id && row.subject && row.body && row.prepared_at && row.public_url &&
    row.selected_contact_reason && row.selected_contact_source_ref && row.selected_contact_confidence &&
    row.content_version && row.subject_template_version && row.body_template_version && row.sender_profile_version &&
    row.sequence_step && row.demo_version_number
  ) {
    const attempts = await db.selectFrom("message_attempt").select(["status"]).where("message_id", "=", row.id).execute();
    const sent = attempts.some((attempt) => attempt.status === "sent" || attempt.status === "delivered");
    const failed = attempts.length > 0 && !sent && attempts.every((attempt) => ["failed", "bounced", "rejected", "cancelled"].includes(attempt.status));
    message = {
      messageId: row.id,
      persistedStatus: row.status,
      liveEligible: eligibility.eligible,
      stale: eligibility.reasons.some((reason) => ["APPROVAL_CHANGED", "HOSTED_PUBLICATION_CHANGED", "PUBLIC_LOCATOR_CHANGED", "CONTACT_CHANGED"].includes(reason.code)),
      to: row.display_value ?? row.normalized_value ?? "",
      contactMethodId: row.contact_method_id,
      contactName: row.full_name,
      contactSelectionReason: row.selected_contact_reason,
      contactSourceRef: row.selected_contact_source_ref,
      contactConfidence: row.selected_contact_confidence,
      subject: row.subject,
      body: row.body,
      preparedAt: iso(row.prepared_at),
      sendReadyAt: row.send_ready_at ? iso(row.send_ready_at) : null,
      campaignName: row.campaign_name ?? CAMPAIGN_NAME,
      campaignVersion: row.policy_version ?? OUTREACH_POLICY_VERSION,
      sequenceName: row.sequence_name ?? SEQUENCE_NAME,
      sequenceVersion: row.sequence_version ?? SEQUENCE_VERSION,
      sequenceStep: row.sequence_step,
      contentVersion: row.content_version,
      subjectTemplateVersion: row.subject_template_version,
      bodyTemplateVersion: row.body_template_version,
      senderProfileVersion: row.sender_profile_version,
      demoVersionId: row.demo_version_id,
      demoVersionNumber: row.demo_version_number,
      demoUrl: row.public_url,
      providerAttemptCount: attempts.length,
      deliveryStatus: sent ? "sent" : failed ? "failed" : "not_sent",
    };
  }
  return {
    prospectId,
    businessId: eligibility.businessId,
    businessName: eligibility.businessName,
    fitScore: eligibility.fitScore,
    status: classify(eligibility, message),
    eligibility,
    message,
    campaign: { name: CAMPAIGN_NAME, version: OUTREACH_POLICY_VERSION },
    sequence: { name: SEQUENCE_NAME, version: SEQUENCE_VERSION },
    senderRequirements: senderProfile().phase12Requirements,
    sendingEnabled: false,
  };
}

export async function listOutreachQueue(db: Database, limit = 50): Promise<OutreachQueueItem[]> {
  const rows = await db
    .selectFrom("prospect as p")
    .innerJoin("business as b", "b.id", "p.business_id")
    .select(["p.id", "b.canonical_name"])
    .where("p.lifecycle_state", "in", ["qualified", "outreach_active", "engaged", "sales_active", "paused"])
    .orderBy("p.state_changed_at", "desc")
    .limit(Math.min(Math.max(limit, 1), 100))
    .execute();
  const views = await Promise.all(rows.map((row) => getProspectOutreachView(db, row.id)));
  return views
    .map((view, index) => ({
      prospectId: view.prospectId,
      businessName: view.businessName ?? rows[index]?.canonical_name ?? "Unknown business",
      fitScore: view.fitScore,
      status: view.status,
      contact: view.eligibility.contact?.email ?? view.message?.to ?? null,
      demoVersionNumber: view.eligibility.artifact?.demoVersionNumber ?? view.message?.demoVersionNumber ?? null,
      messageId: view.message?.messageId ?? null,
      preparedAt: view.message?.preparedAt ?? null,
      reasonCodes: view.eligibility.reasons.map((reason) => reason.code),
    }))
    .sort((a, b) => statusRank(a.status) - statusRank(b.status) || (b.fitScore ?? -1) - (a.fitScore ?? -1) || a.businessName.localeCompare(b.businessName));
}

function classify(eligibility: OutreachEligibilityResult, message: OutreachMessageView | null): OutreachQueueStatus {
  if (eligibility.reasons.some((reason) => reason.code === "ACTIVE_SUPPRESSION") || message?.persistedStatus === "suppressed") return "SUPPRESSED";
  if (message?.stale) return "STALE_PREPARATION";
  if (message?.persistedStatus === "send_ready" && message.liveEligible && message.deliveryStatus === "not_sent") return "SEND_READY";
  if (message?.persistedStatus === "prepared") return "DRAFT_PREPARED";
  if (eligibility.eligible) return "READY_FOR_OUTREACH";
  if (eligibility.reasons.some((reason) => reason.code === "NO_EMAIL_ADDRESS" || reason.code === "INVALID_EMAIL_ADDRESS")) return "NEEDS_CONTACT";
  if (eligibility.reasons.some((reason) => reason.code === "DEMO_NOT_APPROVED")) return "NEEDS_DEMO_APPROVAL";
  return "NEEDS_RETRY";
}

function preparedAgainst(row: { id: string; idempotency_key: string; contact_method_id: string | null; demo_version_id: string | null; demo_public_locator_id: string | null; demo_approval_review_id: string | null; approved_at_snapshot: Date | string | null; hosted_publication_id: string | null }): PreparedAgainst | null {
  if (!row.contact_method_id || !row.demo_version_id || !row.demo_public_locator_id || !row.demo_approval_review_id || !row.approved_at_snapshot || !row.hosted_publication_id) return null;
  return { messageId: row.id, idempotencyKey: row.idempotency_key, contactMethodId: row.contact_method_id, demoVersionId: row.demo_version_id, publicLocatorId: row.demo_public_locator_id, approvalReviewId: row.demo_approval_review_id, approvedAt: iso(row.approved_at_snapshot), hostedPublicationId: row.hosted_publication_id };
}

function statusRank(status: OutreachQueueStatus): number {
  return { SEND_READY: 0, READY_FOR_OUTREACH: 1, DRAFT_PREPARED: 2, STALE_PREPARATION: 3, NEEDS_CONTACT: 4, NEEDS_DEMO_APPROVAL: 5, NEEDS_RETRY: 6, SUPPRESSED: 7 }[status];
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
