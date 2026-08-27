import type { Database } from "@saltbox/database/client";
import {
  BODY_TEMPLATE_VERSION,
  OUTREACH_CONTENT_VERSION,
  SUBJECT_TEMPLATE_VERSION,
  type SenderProfile,
} from "./config.ts";
import type { SelectedEmailContact } from "./types.ts";

export interface SupportedObservation {
  code: string;
  text: string;
  evidenceRef: string;
}

export interface RenderOutreachMessageInput {
  businessName: string;
  category: string | null;
  city: string | null;
  state: string | null;
  demoUrl: string;
  contact: SelectedEmailContact;
  observation: SupportedObservation | null;
  sender: SenderProfile;
}

export interface RenderedOutreachMessage {
  subject: string;
  body: string;
  contentVersion: typeof OUTREACH_CONTENT_VERSION;
  subjectTemplateVersion: typeof SUBJECT_TEMPLATE_VERSION;
  bodyTemplateVersion: typeof BODY_TEMPLATE_VERSION;
  observation: SupportedObservation | null;
}

/** Small, inspectable future subject strategy. Phase 11 deliberately uses A. */
export const SUBJECT_STRATEGY = [
  { version: SUBJECT_TEMPLATE_VERSION, template: "I rebuilt the {{business_name}} website", active: true },
  { version: "outreach-subject-concept-v1", template: "Made a website concept for {{business_name}}", active: false },
  { version: "outreach-subject-put-together-v1", template: "I put this together for {{business_name}}", active: false },
] as const;

export function renderOutreachMessage(input: RenderOutreachMessageInput): RenderedOutreachMessage {
  const businessName = inline(input.businessName);
  const category = inline(input.category ?? "local service");
  const location = [input.city, input.state].map((part) => part && inline(part)).filter(Boolean).join(", ");
  const greetingName = firstName(input.contact.contactName);
  const greeting = greetingName ? `Hi ${greetingName},` : "Hi,";
  const context = location
    ? `I came across ${businessName} while looking at ${category} businesses in ${location}.`
    : `I came across ${businessName} while looking at ${category} businesses.`;
  const bridge = input.observation
    ? `I noticed ${input.observation.text}, so I put together a redesigned version of the site:`
    : "I put together a redesigned direction for the site so you could see the idea instead of reading a generic pitch:";
  const demoUrl = safeHttpsUrl(input.demoUrl);
  const displayName = inline(input.sender.displayName);
  const businessIdentity = inline(input.sender.businessIdentity);
  return {
    subject: `I rebuilt the ${businessName} website`,
    body: [
      greeting,
      "",
      context,
      "",
      bridge,
      "",
      demoUrl,
      "",
      "No obligation — I thought it would be easier to show you what I had in mind than send a generic sales pitch.",
      "",
      "If you want, I can walk you through what I changed.",
      "",
      `— ${displayName}`,
      businessIdentity,
    ].join("\n"),
    contentVersion: OUTREACH_CONTENT_VERSION,
    subjectTemplateVersion: SUBJECT_TEMPLATE_VERSION,
    bodyTemplateVersion: BODY_TEMPLATE_VERSION,
    observation: input.observation,
  };
}

/** Select one concise claim only when the persisted analysis proves it. */
export async function selectSupportedObservation(db: Database, businessId: string): Promise<SupportedObservation | null> {
  const row = await db
    .selectFrom("website_analysis as wa")
    .innerJoin("business_website as bw", "bw.website_id", "wa.website_id")
    .select(["wa.id", "wa.structured_findings"])
    .where("bw.business_id", "=", businessId)
    .where("wa.analyzer_version", "like", "website-intelligence-%")
    .orderBy("wa.calculated_at", "desc")
    .orderBy("wa.id", "desc")
    .limit(1)
    .executeTakeFirst();
  if (!row) return null;
  const findings = record(row.structured_findings);
  const conversion = record(findings?.conversion);
  const mobile = record(findings?.mobile);
  const seo = record(findings?.seo);
  const links = record(findings?.links);
  const evidenceRef = row.id;

  if (conversion?.prominentCtaPresent === false && conversion?.quoteCtaPresent === false) {
    return { code: "CTA_MISSING", text: "the site doesn't have a clear quote button", evidenceRef };
  }
  if (conversion?.contactFormPresent === false) {
    return { code: "CONTACT_FORM_MISSING", text: "the site doesn't offer a clear online contact form", evidenceRef };
  }
  if (mobile?.horizontalOverflow === true || mobile?.contentWiderThanViewport === true) {
    return { code: "MOBILE_OVERFLOW", text: "some site content runs wider than a mobile screen", evidenceRef };
  }
  if (seo?.titlePresent === false) {
    return { code: "TITLE_MISSING", text: "the homepage doesn't have a clear page title", evidenceRef };
  }
  if (seo?.metaDescriptionPresent === false) {
    return { code: "META_DESCRIPTION_MISSING", text: "the homepage doesn't have a search description", evidenceRef };
  }
  if (typeof links?.broken === "number" && links.broken >= 2) {
    return { code: "BROKEN_LINKS", text: "the site has multiple broken internal links", evidenceRef };
  }
  return null;
}

function inline(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

function firstName(fullName: string | null): string | null {
  if (!fullName) return null;
  const clean = inline(fullName);
  const first = clean.split(" ")[0];
  return first && /^[\p{L}\p{M}'’-]{1,50}$/u.test(first) ? first : null;
}

function safeHttpsUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol !== "https:") throw new Error("Outreach demos must use a durable HTTPS URL.");
  url.username = "";
  url.password = "";
  return url.toString();
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
