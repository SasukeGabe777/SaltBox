import { sql } from "kysely";
import type { Database } from "@saltbox/database/client";
import { checkOutreachEligibility as checkSuppressionEligibility } from "@saltbox/database/repositories/suppressions";
import { RECENT_OUTREACH_DAYS } from "./config.ts";
import { selectBestEmailContact } from "./contact-selection.ts";
import type {
  OutreachArtifactSnapshot,
  OutreachEligibilityReason,
  OutreachEligibilityResult,
  PreparedAgainst,
} from "./types.ts";

export interface CheckOutreachEligibilityOptions {
  preparedAgainst?: PreparedAgainst;
  lockDemo?: boolean;
}

/**
 * The authoritative, reusable pre-send boundary. Phase 11 calls it during
 * preparation; every future provider path must call it again immediately
 * before creating a MessageAttempt or performing external I/O.
 */
export async function checkOutreachEligibility(
  db: Database,
  prospectId: string,
  options: CheckOutreachEligibilityOptions = {},
): Promise<OutreachEligibilityResult> {
  const reasons: OutreachEligibilityReason[] = [];
  const prospect = await db
    .selectFrom("prospect as p")
    .innerJoin("business as b", "b.id", "p.business_id")
    .select([
      "p.id",
      "p.business_id",
      "p.lifecycle_state",
      "b.canonical_name",
      "b.category",
      "b.status as business_status",
    ])
    .where("p.id", "=", prospectId)
    .executeTakeFirst();

  if (!prospect) {
    add(reasons, "PROSPECT_NOT_FOUND", "The prospect and its business identity do not exist.");
    return emptyResult(prospectId, reasons);
  }
  if (prospect.business_status !== "active") {
    add(reasons, "BUSINESS_INACTIVE", "The business identity is not active.", prospect.business_id);
  }

  const [score, locationRow, contactSelection] = await Promise.all([
    db
      .selectFrom("lead_score")
      .select(["id", "overall_score"])
      .where("prospect_id", "=", prospectId)
      .orderBy("calculated_at", "desc")
      .orderBy("id", "desc")
      .limit(1)
      .executeTakeFirst(),
    db
      .selectFrom("source_record")
      .select("provider_metadata")
      .where("business_id", "=", prospect.business_id)
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst(),
    selectBestEmailContact(db, prospect.business_id),
  ]);
  const decision = score
    ? await db
        .selectFrom("decision")
        .select(["id", "result_code", "policy_version"])
        .where("prospect_id", "=", prospectId)
        .where("lead_score_id", "=", score.id)
        .orderBy("decided_at", "desc")
        .orderBy("id", "desc")
        .limit(1)
        .executeTakeFirst()
    : undefined;
  if (decision?.result_code !== "qualified" || decision.policy_version !== "qualification-policy-v2") {
    add(reasons, "PROSPECT_NOT_QUALIFIED", "The latest score has no qualifying qualification-policy-v2 decision.", decision?.id);
  }

  const contact = contactSelection.selected;
  if (!contact) {
    const invalid = contactSelection.rejected.some((item) => item.code === "INVALID_EMAIL_ADDRESS");
    add(
      reasons,
      invalid ? "INVALID_EMAIL_ADDRESS" : "NO_EMAIL_ADDRESS",
      invalid ? "Persisted email candidates are invalid or marked unusable." : "No usable persisted email address is available.",
      ...contactSelection.rejected.map((item) => item.contactMethodId),
    );
  }

  if (contact) {
    const suppression = await checkSuppressionEligibility(db, {
      businessId: prospect.business_id,
      prospectId,
      channel: "email",
      ...(contact.contactId ? { contactId: contact.contactId } : {}),
      contactMethodId: contact.contactMethodId,
      normalizedAddress: contact.normalizedEmail,
    });
    if (!suppression.eligible) {
      add(reasons, "ACTIVE_SUPPRESSION", "An active suppression applies to this email outreach.", ...suppression.blockingSuppressionIds);
    }
  } else {
    // Global/business/prospect/channel suppressions still matter even when no
    // contact exists, so the operator sees the strongest safety blocker.
    const suppression = await checkSuppressionEligibility(db, {
      businessId: prospect.business_id,
      prospectId,
      channel: "email",
    });
    if (!suppression.eligible) {
      add(reasons, "ACTIVE_SUPPRESSION", "An active suppression applies to this prospect.", ...suppression.blockingSuppressionIds);
    }
  }

  let demoQuery = db
    .selectFrom("demo")
    .select(["id", "approved_demo_version_id", "approval_review_id", "approved_at", "status"])
    .where("prospect_id", "=", prospectId)
    .where("status", "not in", ["archived", "expired"])
    .orderBy("created_at", "desc")
    .limit(1);
  if (options.lockDemo) demoQuery = demoQuery.forUpdate();
  const demo = await demoQuery.executeTakeFirst();

  let artifact: OutreachArtifactSnapshot | null = null;
  if (!demo?.approved_demo_version_id || !demo.approval_review_id || !demo.approved_at) {
    add(reasons, "DEMO_NOT_APPROVED", "No exact DemoVersion is currently approved by an operator.", demo?.id);
  } else {
    const [version, qa, locator, publication] = await Promise.all([
      db
        .selectFrom("demo_version")
        .select(["id", "version_number"])
        .where("id", "=", demo.approved_demo_version_id)
        .where("demo_id", "=", demo.id)
        .executeTakeFirst(),
      db
        .selectFrom("demo_version_qa_result")
        .select(["id", "status", "critical_failure_count"])
        .where("demo_version_id", "=", demo.approved_demo_version_id)
        .orderBy("completed_at", "desc")
        .orderBy("id", "desc")
        .limit(1)
        .executeTakeFirst(),
      db
        .selectFrom("demo_public_locator")
        .select(["id", "token"])
        .where("demo_id", "=", demo.id)
        .where("status", "=", "active")
        .where((eb) => eb.or([eb("expires_at", "is", null), eb("expires_at", ">", sql<Date>`now()`)]))
        .orderBy("created_at", "desc")
        .limit(1)
        .executeTakeFirst(),
      db
        .selectFrom("demo_publication")
        .select(["id", "demo_version_id", "status", "public_url"])
        .where("demo_id", "=", demo.id)
        .where("demo_version_id", "=", demo.approved_demo_version_id)
        .where("environment", "=", "hosted")
        .where("status", "=", "published")
        .orderBy("completed_at", "desc")
        .orderBy("id", "desc")
        .limit(1)
        .executeTakeFirst(),
    ]);
    if (!qa || qa.status !== "passed" || qa.critical_failure_count > 0) {
      add(reasons, "DEMO_QA_UNSAFE", "The approved DemoVersion lacks a clean current QA result.", qa?.id);
    }
    if (!locator) add(reasons, "PUBLIC_LOCATOR_UNAVAILABLE", "The demo has no active public locator.", demo.id);
    const hostedUrl = publication?.public_url && validHostedUrl(publication.public_url) ? publication.public_url : null;
    if (!publication || !hostedUrl) {
      add(reasons, "DEMO_NOT_HOSTED", "The approved DemoVersion is not published at a durable HTTPS URL.", publication?.id);
    }
    if (version && locator && publication && hostedUrl) {
      artifact = {
        demoId: demo.id,
        demoVersionId: version.id,
        demoVersionNumber: version.version_number,
        publicLocatorId: locator.id,
        publicLocatorToken: locator.token,
        approvalReviewId: demo.approval_review_id,
        approvedAt: iso(demo.approved_at),
        hostedPublicationId: publication.id,
        hostedUrl,
      };
    }
  }

  if (options.preparedAgainst) {
    const prepared = options.preparedAgainst;
    if (!artifact || artifact.demoVersionId !== prepared.demoVersionId || artifact.approvalReviewId !== prepared.approvalReviewId || artifact.approvedAt !== prepared.approvedAt) {
      add(reasons, "APPROVAL_CHANGED", "The prepared message is not pinned to the currently approved DemoVersion and review.", prepared.demoVersionId);
    }
    if (!artifact || artifact.hostedPublicationId !== prepared.hostedPublicationId) {
      add(reasons, "HOSTED_PUBLICATION_CHANGED", "The hosted publication differs from the one used during preparation.", prepared.hostedPublicationId);
    }
    if (!artifact || artifact.publicLocatorId !== prepared.publicLocatorId) {
      add(reasons, "PUBLIC_LOCATOR_CHANGED", "The active public locator differs from the one used during preparation.", prepared.publicLocatorId);
    }
    if (!contact || contact.contactMethodId !== prepared.contactMethodId) {
      add(reasons, "CONTACT_CHANGED", "The selected email contact differs from the one used during preparation.", prepared.contactMethodId);
    }
  }

  if (contact) {
    const recent = await db
      .selectFrom("message_attempt as ma")
      .innerJoin("message as m", "m.id", "ma.message_id")
      .select("ma.id")
      .where("m.prospect_id", "=", prospectId)
      .where("m.contact_method_id", "=", contact.contactMethodId)
      .where("ma.status", "in", ["sent", "delivered"])
      .where(sql<boolean>`coalesce(ma.sent_at, ma.delivered_at, ma.queued_at) >= now() - (${RECENT_OUTREACH_DAYS} * interval '1 day')`)
      .$if(options.preparedAgainst?.messageId !== undefined, (qb) => qb.where("m.id", "!=", options.preparedAgainst?.messageId as string))
      .limit(1)
      .executeTakeFirst();
    if (recent) add(reasons, "RECENT_OUTREACH_EXISTS", `A successful email attempt exists within ${RECENT_OUTREACH_DAYS} days.`, recent.id);
  }

  if (options.preparedAgainst?.idempotencyKey) {
    const duplicate = await db
      .selectFrom("message")
      .select("id")
      .where("channel", "=", "email")
      .where("idempotency_key", "=", options.preparedAgainst.idempotencyKey)
      .$if(options.preparedAgainst.messageId !== undefined, (qb) => qb.where("id", "!=", options.preparedAgainst?.messageId as string))
      .limit(1)
      .executeTakeFirst();
    if (duplicate) add(reasons, "DUPLICATE_MESSAGE_INTENT", "Another message intent already owns this logical preparation key.", duplicate.id);
  }

  const metadata = record(locationRow?.provider_metadata);
  return {
    eligible: reasons.length === 0,
    reasons,
    prospectId,
    businessId: prospect.business_id,
    businessName: prospect.canonical_name,
    category: prospect.category,
    city: stringValue(metadata?.city),
    state: stringValue(metadata?.state),
    fitScore: score?.overall_score ?? null,
    contact,
    artifact,
  };
}

function add(reasons: OutreachEligibilityReason[], code: OutreachEligibilityReason["code"], detail: string, ...refs: Array<string | undefined>): void {
  if (reasons.some((reason) => reason.code === code)) return;
  reasons.push({ code, detail, refs: refs.filter((ref): ref is string => typeof ref === "string") });
}

function emptyResult(prospectId: string, reasons: OutreachEligibilityReason[]): OutreachEligibilityResult {
  return { eligible: false, reasons, prospectId, businessId: null, businessName: null, category: null, city: null, state: null, fitScore: null, contact: null, artifact: null };
}

function validHostedUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
