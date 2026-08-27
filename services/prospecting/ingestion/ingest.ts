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
} from "@saltbox/database/repositories/businesses";
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

export interface IngestionResult {
  sourceId: string;
  sourceRecordId: string;
  businessId: string;
  businessCreated: boolean;
  emailContactMethodId?: string;
  phoneContactMethodId?: string;
  domainId?: string;
  websiteId?: string;
}

const IDENTIFIER_TYPE = "external_id";

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
  if (businessId === null) {
    const matched = await findBusinessByExternalIdentifier(db, {
      provider: input.source,
      identifierType: IDENTIFIER_TYPE,
      value: input.externalId,
    });
    if (matched) {
      businessId = matched.id;
    } else {
      const business = await createBusiness(db, {
        canonicalName: input.name,
        ...(input.industry !== undefined ? { category: input.industry } : {}),
      });
      businessId = business.id;
      businessCreated = true;
      await addBusinessIdentifier(db, {
        businessId,
        provider: input.source,
        identifierType: IDENTIFIER_TYPE,
        value: input.externalId,
      });
    }
    await linkSourceRecordToBusiness(db, sourceRecord.id, businessId);
  }

  const result: IngestionResult = {
    sourceId,
    sourceRecordId: sourceRecord.id,
    businessId,
    businessCreated,
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
    const host = new URL(input.websiteUrl).hostname;
    result.domainId = await ensureDomain(db, host);
    result.websiteId = await ensureBusinessWebsite(db, {
      businessId,
      domainId: result.domainId,
      canonicalUrl: input.websiteUrl,
    });
  }

  return result;
}
