/**
 * Controlled business ingestion (Phase 4: fixtures/local inputs only).
 *
 * Identity is idempotent through database constraints: re-ingesting the same
 * (source, external_id) refreshes retrieval metadata and reuses the existing
 * business, contact methods, domain, and website rows.
 */

import type { Database } from "@saltbox/database/client";
import {
  createBusiness,
  addBusinessIdentifier,
  findBusinessByExternalIdentifier,
  findBusinessIdsByDomainHost,
  findBusinessIdsByPhone,
} from "@saltbox/database/repositories/businesses";
import { createEntityMatchCandidate } from "@saltbox/database/repositories/entity-matches";
import { ensureSource, upsertSourceRecord, linkSourceRecordToBusiness } from "@saltbox/database/repositories/sources";
import {
  upsertContactMethod,
  normalizeEmail,
  normalizePhone,
} from "@saltbox/database/repositories/contact-methods";
import { ensureDomain, ensureBusinessWebsite } from "@saltbox/database/repositories/websites";

export interface ControlledBusinessInput {
  name: string;
  websiteUrl?: string;
  phone?: string;
  email?: string;
  city?: string;
  state?: string;
  industry?: string;
  /** Stable source identity, e.g. "manual_fixture". */
  source: string;
  /** Stable external id within the source namespace, e.g. "fixture-roofing-001". */
  externalId: string;
  /** Provider-neutral provenance used by real discovery adapters. */
  sourceType?: string;
  sourceDescription?: string;
  sourceRetentionClass?: string;
  sourceLocator?: string;
  sourceRetrievedAt?: Date;
  sourceContentHash?: string;
  sourceMetadata?: Record<string, unknown>;
}

/** How this ingestion arrived at the business identity. */
export type BusinessIdentityDisposition =
  | "existing_source_identity"
  | "cross_source_linked"
  | "created"
  | "created_ambiguous";

export interface IngestionResult {
  sourceId: string;
  sourceRecordId: string;
  businessId: string;
  businessCreated: boolean;
  identityDisposition: BusinessIdentityDisposition;
  /** Strong signals that supported a cross-source auto-link, when one occurred. */
  crossSourceSignals?: Record<string, string>;
  emailContactMethodId?: string;
  phoneContactMethodId?: string;
  domainId?: string;
  websiteId?: string;
}

const IDENTIFIER_TYPE = "external_id";
/**
 * Versioned conservative cross-source identity policy (ADR-004): an unknown
 * (source, external_id) may auto-link to an existing business only when exact
 * strong signals — normalized registrable website host or normalized business
 * phone — all agree on exactly ONE business. Conflicting strong signals create
 * a separate business plus pending EntityMatchCandidate records for review.
 * Name similarity alone never links or merges anything.
 */
export const CROSS_SOURCE_IDENTITY_POLICY_VERSION = "cross-source-identity-v1";

interface StrongSignalMatch {
  kind: "none" | "unique" | "ambiguous";
  businessIds: string[];
  signals: Record<string, string>;
}

/** Loopback/IP/dot-less hosts are not stable business identities. */
function matchableDomainHost(websiteUrl: string): string | null {
  let host: string;
  try {
    host = new URL(websiteUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host === "localhost" || !host.includes(".")) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return null;
  return host;
}

async function matchByStrongSignals(db: Database, input: ControlledBusinessInput): Promise<StrongSignalMatch> {
  const signals: Record<string, string> = {};
  const matchedIds = new Set<string>();

  if (input.websiteUrl !== undefined && input.websiteUrl.trim() !== "") {
    const host = matchableDomainHost(input.websiteUrl);
    if (host) {
      const ids = await findBusinessIdsByDomainHost(db, host);
      if (ids.length > 0) {
        signals.domain = host;
        for (const id of ids) matchedIds.add(id);
      }
    }
  }
  if (input.phone !== undefined && input.phone.trim() !== "") {
    const normalized = normalizePhone(input.phone);
    if (normalized.replace(/\D/g, "").length >= 7) {
      const ids = await findBusinessIdsByPhone(db, normalized);
      if (ids.length > 0) {
        signals.phone = normalized;
        for (const id of ids) matchedIds.add(id);
      }
    }
  }

  const businessIds = [...matchedIds].sort();
  if (businessIds.length === 0) return { kind: "none", businessIds, signals };
  return { kind: businessIds.length === 1 ? "unique" : "ambiguous", businessIds, signals };
}

export async function ingestControlledBusiness(
  db: Database,
  input: ControlledBusinessInput
): Promise<IngestionResult> {
  const sourceId = await ensureSource(db, {
    name: input.source,
    sourceType: input.sourceType ?? "manual",
    description: input.sourceDescription ?? "Controlled Phase 4 input path (fixtures and local developer tooling).",
    ...(input.sourceRetentionClass !== undefined ? { retentionClass: input.sourceRetentionClass } : {}),
  });

  const sourceRecord = await upsertSourceRecord(db, {
    sourceId,
    externalId: input.externalId,
    ...(input.sourceRetrievedAt !== undefined ? { retrievedAt: input.sourceRetrievedAt } : {}),
    ...(input.sourceLocator !== undefined ? { sourceLocator: input.sourceLocator } : {}),
    ...(input.sourceContentHash !== undefined ? { contentHash: input.sourceContentHash } : {}),
    ...(input.sourceMetadata !== undefined ? { providerMetadata: input.sourceMetadata } : {}),
  });

  let businessId = sourceRecord.businessId;
  let businessCreated = false;
  let identityDisposition: BusinessIdentityDisposition = "existing_source_identity";
  let crossSourceSignals: Record<string, string> | undefined;
  if (businessId === null) {
    const matched = await findBusinessByExternalIdentifier(db, {
      provider: input.source,
      identifierType: IDENTIFIER_TYPE,
      value: input.externalId,
    });
    if (matched) {
      businessId = matched.id;
    } else {
      const strongMatch = await matchByStrongSignals(db, input);
      if (strongMatch.kind === "unique") {
        // Exactly one business shares an exact strong identity signal:
        // attach this provider identity to it instead of duplicating.
        businessId = strongMatch.businessIds[0]!;
        identityDisposition = "cross_source_linked";
        crossSourceSignals = strongMatch.signals;
        await addBusinessIdentifier(db, {
          businessId,
          provider: input.source,
          identifierType: IDENTIFIER_TYPE,
          value: input.externalId,
        });
        await createEntityMatchCandidate(db, {
          subjectKind: "source_record",
          subjectId: sourceRecord.id,
          candidateBusinessId: businessId,
          signals: strongMatch.signals,
          confidence: "high",
          resolutionPolicyVersion: CROSS_SOURCE_IDENTITY_POLICY_VERSION,
          status: "auto_linked",
          resolutionReason: `Exact normalized ${Object.keys(strongMatch.signals).join(" + ")} match.`,
          resolvedByActorType: "system",
          resolvedByActorRef: "prospecting-ingestion",
        });
      } else {
        const business = await createBusiness(db, {
          canonicalName: input.name,
          ...(input.industry !== undefined ? { category: input.industry } : {}),
        });
        businessId = business.id;
        businessCreated = true;
        identityDisposition = strongMatch.kind === "ambiguous" ? "created_ambiguous" : "created";
        await addBusinessIdentifier(db, {
          businessId,
          provider: input.source,
          identifierType: IDENTIFIER_TYPE,
          value: input.externalId,
        });
        if (strongMatch.kind === "ambiguous") {
          // Signals point at more than one business: keep this one separate
          // and record pending candidates for review — never silently merge.
          for (const candidateBusinessId of strongMatch.businessIds.slice(0, 5)) {
            await createEntityMatchCandidate(db, {
              subjectKind: "business",
              subjectId: businessId,
              candidateBusinessId,
              signals: strongMatch.signals,
              confidence: "medium",
              resolutionPolicyVersion: CROSS_SOURCE_IDENTITY_POLICY_VERSION,
            });
          }
        }
      }
    }
    await linkSourceRecordToBusiness(db, sourceRecord.id, businessId);
  }

  const result: IngestionResult = {
    sourceId,
    sourceRecordId: sourceRecord.id,
    businessId,
    businessCreated,
    identityDisposition,
    ...(crossSourceSignals !== undefined ? { crossSourceSignals } : {}),
  };

  if (input.email !== undefined && input.email.trim() !== "") {
    result.emailContactMethodId = await upsertContactMethod(db, {
      businessId,
      channel: "email",
      normalizedValue: normalizeEmail(input.email),
      displayValue: input.email.trim(),
    });
  }
  if (input.phone !== undefined && input.phone.trim() !== "") {
    result.phoneContactMethodId = await upsertContactMethod(db, {
      businessId,
      channel: "phone",
      normalizedValue: normalizePhone(input.phone),
      displayValue: input.phone.trim(),
    });
  }

  if (input.websiteUrl !== undefined && input.websiteUrl.trim() !== "") {
    // A malformed provider URL is target evidence, not a database/system
    // failure. The analyzer records the invalid-target classification; identity
    // ingestion deliberately omits a website row that cannot have a valid host.
    let parsed: URL | null = null;
    try {
      parsed = new URL(input.websiteUrl);
    } catch {
      // The deep analyzer owns the structured invalid_target evidence.
    }
    if (parsed) {
      result.domainId = await ensureDomain(db, parsed.hostname);
      result.websiteId = await ensureBusinessWebsite(db, {
        businessId,
        domainId: result.domainId,
        canonicalUrl: input.websiteUrl,
      });
    }
  }

  return result;
}
