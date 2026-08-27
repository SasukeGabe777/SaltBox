import type { ConfidenceBand } from "@saltbox/database/generated";

export type OutreachEligibilityReasonCode =
  | "PROSPECT_NOT_FOUND"
  | "BUSINESS_INACTIVE"
  | "PROSPECT_NOT_QUALIFIED"
  | "ACTIVE_SUPPRESSION"
  | "NO_EMAIL_ADDRESS"
  | "INVALID_EMAIL_ADDRESS"
  | "DEMO_NOT_APPROVED"
  | "DEMO_QA_UNSAFE"
  | "DEMO_NOT_HOSTED"
  | "PUBLIC_LOCATOR_UNAVAILABLE"
  | "RECENT_OUTREACH_EXISTS"
  | "DUPLICATE_MESSAGE_INTENT"
  | "APPROVAL_CHANGED"
  | "HOSTED_PUBLICATION_CHANGED"
  | "PUBLIC_LOCATOR_CHANGED"
  | "CONTACT_CHANGED";

export interface OutreachEligibilityReason {
  code: OutreachEligibilityReasonCode;
  detail: string;
  refs: string[];
}

export interface EmailValidation {
  normalized: string;
  syntaxValid: boolean;
  domainSyntaxValid: boolean;
  domain: string | null;
  dnsChecked: false;
  mxChecked: false;
  mailboxConfirmed: false;
}

export type ContactSelectionReason =
  | "DIRECT_KNOWN_CONTACT"
  | "BUSINESS_DOMAIN_EMAIL"
  | "SHARED_BUSINESS_EMAIL"
  | "OTHER_VALID_EMAIL";

export interface SelectedEmailContact {
  contactMethodId: string;
  contactId: string | null;
  contactName: string | null;
  email: string;
  normalizedEmail: string;
  selectionReason: ContactSelectionReason;
  sourceKind: "contact_method";
  sourceRef: string;
  confidence: ConfidenceBand;
  validationStatus: string;
  validation: EmailValidation;
}

export interface OutreachArtifactSnapshot {
  demoId: string;
  demoVersionId: string;
  demoVersionNumber: number;
  publicLocatorId: string;
  publicLocatorToken: string;
  approvalReviewId: string;
  approvedAt: string;
  hostedPublicationId: string;
  hostedUrl: string;
}

export interface OutreachEligibilityResult {
  eligible: boolean;
  reasons: OutreachEligibilityReason[];
  prospectId: string;
  businessId: string | null;
  businessName: string | null;
  category: string | null;
  city: string | null;
  state: string | null;
  fitScore: number | null;
  contact: SelectedEmailContact | null;
  artifact: OutreachArtifactSnapshot | null;
}

export interface PreparedAgainst {
  messageId?: string;
  idempotencyKey?: string;
  contactMethodId: string;
  demoVersionId: string;
  publicLocatorId: string;
  approvalReviewId: string;
  approvedAt: string;
  hostedPublicationId: string;
}

export type OutreachQueueStatus =
  | "READY_FOR_OUTREACH"
  | "DRAFT_PREPARED"
  | "SEND_READY"
  | "SUPPRESSED"
  | "NEEDS_CONTACT"
  | "NEEDS_DEMO_APPROVAL"
  | "NEEDS_RETRY"
  | "STALE_PREPARATION";
