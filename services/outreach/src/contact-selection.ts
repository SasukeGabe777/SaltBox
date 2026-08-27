import type { Database } from "@saltbox/database/client";
import type { ConfidenceBand } from "@saltbox/database/generated";
import type {
  ContactSelectionReason,
  EmailValidation,
  SelectedEmailContact,
} from "./types.ts";

const BLOCKED_LOCAL_PARTS = new Set([
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
  "mailer-daemon",
  "postmaster",
]);
const SHARED_LOCAL_PARTS = new Set([
  "hello",
  "contact",
  "info",
  "office",
  "sales",
  "support",
  "service",
  "admin",
]);

export function validateEmailAddress(input: string): EmailValidation {
  const normalized = input.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  const local = at > 0 ? normalized.slice(0, at) : "";
  const domain = at > 0 && at === normalized.indexOf("@") ? normalized.slice(at + 1) : "";
  const localValid =
    local.length > 0 &&
    local.length <= 64 &&
    !local.startsWith(".") &&
    !local.endsWith(".") &&
    !local.includes("..") &&
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local);
  const domainValid =
    domain.length > 0 &&
    domain.length <= 253 &&
    domain.split(".").every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        !label.startsWith("-") &&
        !label.endsWith("-") &&
        /^[a-z0-9-]+$/i.test(label),
    );
  return {
    normalized,
    syntaxValid: normalized.length <= 254 && localValid && domainValid,
    domainSyntaxValid: domainValid,
    domain: domainValid ? domain : null,
    dnsChecked: false,
    mxChecked: false,
    mailboxConfirmed: false,
  };
}

export function isObviousNonRecipientAddress(email: string): boolean {
  const local = email.toLowerCase().split("@")[0] ?? "";
  return BLOCKED_LOCAL_PARTS.has(local) || /^(?:no-?reply|do-?not-?reply)(?:[+._-]|$)/i.test(local);
}

interface Candidate {
  id: string;
  contactId: string | null;
  contactName: string | null;
  normalizedValue: string;
  displayValue: string | null;
  validationStatus: string;
  confidence: ConfidenceBand;
  deliveryHealth: string;
  contactActive: boolean;
}

export interface ContactSelectionResult {
  selected: SelectedEmailContact | null;
  rejected: Array<{ contactMethodId: string; code: "INVALID_EMAIL_ADDRESS" | "UNDESIRABLE_EMAIL_ADDRESS"; detail: string }>;
}

/** Deterministic, evidence-preserving selection of one persisted email. */
export async function selectBestEmailContact(db: Database, businessId: string): Promise<ContactSelectionResult> {
  const [rows, website] = await Promise.all([
    db
      .selectFrom("contact_method as cm")
      .leftJoin("contact as c", "c.id", "cm.contact_id")
      .select([
        "cm.id",
        "cm.contact_id",
        "cm.normalized_value",
        "cm.display_value",
        "cm.validation_status",
        "cm.confidence",
        "cm.delivery_health",
        "c.full_name",
        "c.business_id as contact_business_id",
        "c.status as contact_status",
      ])
      .where("cm.business_id", "=", businessId)
      .where("cm.channel", "=", "email")
      .orderBy("cm.created_at", "asc")
      .execute(),
    db
      .selectFrom("business_website as bw")
      .innerJoin("website as w", "w.id", "bw.website_id")
      .select("w.canonical_url")
      .where("bw.business_id", "=", businessId)
      .where("bw.is_primary", "=", true)
      .orderBy("bw.created_at", "desc")
      .limit(1)
      .executeTakeFirst(),
  ]);

  const websiteDomain = hostname(website?.canonical_url ?? null);
  const rejected: ContactSelectionResult["rejected"] = [];
  const candidates: Array<{ candidate: Candidate; validation: EmailValidation; reason: ContactSelectionReason; rank: number }> = [];

  for (const row of rows) {
    const validation = validateEmailAddress(row.normalized_value);
    if (!validation.syntaxValid || row.validation_status === "invalid" || row.delivery_health === "failing") {
      rejected.push({ contactMethodId: row.id, code: "INVALID_EMAIL_ADDRESS", detail: "The persisted email is syntactically invalid or marked unusable." });
      continue;
    }
    if (isObviousNonRecipientAddress(validation.normalized)) {
      rejected.push({ contactMethodId: row.id, code: "UNDESIRABLE_EMAIL_ADDRESS", detail: "The address is an obvious automated/non-recipient mailbox." });
      continue;
    }
    const candidate: Candidate = {
      id: row.id,
      contactId: row.contact_id,
      contactName: row.contact_status === "active" && row.contact_business_id === businessId ? row.full_name : null,
      normalizedValue: row.normalized_value,
      displayValue: row.display_value,
      validationStatus: row.validation_status,
      confidence: row.confidence,
      deliveryHealth: row.delivery_health,
      contactActive: row.contact_status === "active" && row.contact_business_id === businessId,
    };
    const local = validation.normalized.split("@")[0] ?? "";
    const direct = candidate.contactId !== null && candidate.contactActive && candidate.contactName !== null;
    const sameDomain = websiteDomain !== null && validation.domain === websiteDomain;
    const shared = SHARED_LOCAL_PARTS.has(local);
    const reason: ContactSelectionReason = direct
      ? "DIRECT_KNOWN_CONTACT"
      : sameDomain && !shared
        ? "BUSINESS_DOMAIN_EMAIL"
        : shared
          ? "SHARED_BUSINESS_EMAIL"
          : "OTHER_VALID_EMAIL";
    const rank =
      reasonRank(reason) + validationRank(row.validation_status) + confidenceRank(row.confidence) + deliveryRank(row.delivery_health);
    candidates.push({ candidate, validation, reason, rank });
  }

  candidates.sort((a, b) => b.rank - a.rank || a.validation.normalized.localeCompare(b.validation.normalized));
  const best = candidates[0];
  if (!best) return { selected: null, rejected };
  return {
    selected: {
      contactMethodId: best.candidate.id,
      contactId: best.candidate.contactId,
      contactName: best.candidate.contactName,
      email: best.candidate.displayValue ?? best.validation.normalized,
      normalizedEmail: best.validation.normalized,
      selectionReason: best.reason,
      sourceKind: "contact_method",
      sourceRef: best.candidate.id,
      confidence: best.candidate.confidence,
      validationStatus: best.candidate.validationStatus,
      validation: best.validation,
    },
    rejected,
  };
}

function hostname(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function reasonRank(reason: ContactSelectionReason): number {
  return { DIRECT_KNOWN_CONTACT: 400, BUSINESS_DOMAIN_EMAIL: 300, SHARED_BUSINESS_EMAIL: 200, OTHER_VALID_EMAIL: 100 }[reason];
}

function validationRank(status: string): number {
  return status === "valid" ? 30 : status === "unverified" ? 10 : 0;
}

function confidenceRank(confidence: ConfidenceBand): number {
  return { verified: 20, high: 15, medium: 10, low: 5, unknown: 0 }[confidence];
}

function deliveryRank(health: string): number {
  return health === "ok" ? 5 : health === "unknown" ? 2 : 0;
}
