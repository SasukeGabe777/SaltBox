/**
 * Persistence for website-intelligence runs using the existing Phase 3
 * schema — no migration:
 *
 * - source "website_intelligence" (type crawl) + one source_record
 *   per run give observations attributable provenance (ADR-004);
 * - one immutable website_snapshot per analyzed page;
 * - one versioned website_analysis per run with a bounded structured summary
 *   and links to exactly this run's snapshots (append-only history);
 * - typed observations under the website.* namespace, subject = website.
 *
 * Screenshots / raw Lighthouse JSON stay on the filesystem; the analysis
 * stores only relative artifact references.
 */

import { randomUUID } from "node:crypto";
import type { Database } from "@saltbox/database/client";
import { recordObservation, type ObservationValue } from "@saltbox/database/repositories/observations";
import { ensureSource, upsertSourceRecord, linkSourceRecordToBusiness } from "@saltbox/database/repositories/sources";
import { recordWebsiteAnalysis, recordWebsiteSnapshot } from "@saltbox/database/repositories/websites";
import type { WebsiteIntelligenceResult } from "./types.ts";
import { FINDINGS_SCHEMA_VERSION } from "./version.ts";

export const INTELLIGENCE_SOURCE_NAME = "website_intelligence";

export interface PersistedIntelligence {
  analysisId: string;
  snapshotIds: string[];
  observationCount: number;
  sourceRecordId: string;
}

export async function persistIntelligenceRun(
  db: Database,
  input: {
    businessId: string;
    websiteId: string;
    result: WebsiteIntelligenceResult;
    /** Relative artifact directory name recorded in findings (never absolute). */
    artifactRef?: string;
  },
): Promise<PersistedIntelligence> {
  const { result } = input;
  const observedAt = new Date(result.startedAt);
  const runExternalId = `run-${randomUUID()}`;

  const sourceId = await ensureSource(db, {
    name: INTELLIGENCE_SOURCE_NAME,
    sourceType: "crawl",
    description: "Bounded deterministic website-intelligence browser analysis (Phase 6).",
    retentionClass: "website-evidence",
  });
  const sourceRecord = await upsertSourceRecord(db, {
    sourceId,
    externalId: runExternalId,
    retrievedAt: observedAt,
    sourceLocator: result.finalHomepageUrl ?? result.websiteUrl,
    providerMetadata: {
      analyzerVersion: result.analyzerVersion,
      pages: result.pages.map((page) => page.url),
      durationMs: result.durationMs,
    },
  });
  await linkSourceRecordToBusiness(db, sourceRecord.id, input.businessId);

  const snapshotIds: string[] = [];
  for (const page of result.pages) {
    snapshotIds.push(
      await recordWebsiteSnapshot(db, {
        websiteId: input.websiteId,
        requestedUrl: page.url,
        ...(page.finalUrl !== null ? { finalUrl: page.finalUrl } : {}),
        crawlScope: `intelligence:${page.role}`,
        ...(page.httpStatus !== null ? { httpStatus: page.httpStatus } : {}),
        ...(result.technical ? { httpsOk: result.technical.https } : {}),
        ...(page.contentHash !== null ? { contentHash: page.contentHash } : {}),
        observedAt,
        captureToolVersion: result.analyzerVersion,
      }),
    );
  }

  const structuredFindings = buildStructuredFindings(result, input.artifactRef);
  const analysisId = await recordWebsiteAnalysis(db, {
    websiteId: input.websiteId,
    analyzerVersion: result.analyzerVersion,
    findingsSchemaVersion: FINDINGS_SCHEMA_VERSION,
    structuredFindings,
    confidence: "high",
    snapshotIds,
  });

  let observationCount = 0;
  const observe = async (fieldKey: string, value: ObservationValue) => {
    await recordObservation(db, {
      subjectKind: "website",
      subjectId: input.websiteId,
      fieldKey,
      value,
      sourceId,
      sourceRecordId: sourceRecord.id,
      observedAt,
      confidence: "verified",
      verificationMethod: result.analyzerVersion,
      ...(input.artifactRef !== undefined ? { evidenceRef: input.artifactRef } : {}),
    });
    observationCount += 1;
  };

  for (const [fieldKey, value] of intelligenceObservations(result)) {
    await observe(fieldKey, value);
  }

  return { analysisId, snapshotIds, observationCount, sourceRecordId: sourceRecord.id };
}

/** Bounded, versioned summary stored in website_analysis.structured_findings. */
export function buildStructuredFindings(
  result: WebsiteIntelligenceResult,
  artifactRef?: string,
): Record<string, unknown> {
  return {
    kind: "website-intelligence",
    analyzerVersion: result.analyzerVersion,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    durationMs: result.durationMs,
    websiteUrl: result.websiteUrl,
    finalHomepageUrl: result.finalHomepageUrl,
    stages: result.stages,
    pages: result.pages.map((page) => ({
      url: page.url,
      role: page.role,
      httpStatus: page.httpStatus,
      reachable: page.reachable,
      title: page.title,
      wordCount: page.wordCount,
    })),
    lab: result.lab,
    mobile: result.mobile,
    technical: result.technical,
    seo: result.seo,
    conversion: result.conversion,
    content: result.content,
    links: result.links,
    assets: result.assets,
    platform: result.platform,
    social: result.social,
    ...(artifactRef !== undefined
      ? {
          artifacts: {
            ref: artifactRef,
            desktopScreenshot: result.artifacts?.desktopScreenshot ?? null,
            mobileScreenshot: result.artifacts?.mobileScreenshot ?? null,
            lighthouseReport: result.artifacts?.lighthouseReport ?? null,
          },
        }
      : {}),
    ...(result.fatal !== undefined ? { fatal: result.fatal } : {}),
  };
}

/** website.* observation namespace (documented in the service README). */
export function intelligenceObservations(result: WebsiteIntelligenceResult): Array<[string, ObservationValue]> {
  const rows: Array<[string, ObservationValue]> = [];
  const number = (key: string, value: number | null, unit?: string) => {
    if (value !== null) rows.push([key, { kind: "number", value, ...(unit !== undefined ? { unit } : {}) }]);
  };
  const boolean = (key: string, value: boolean | null) => {
    if (value !== null) rows.push([key, { kind: "boolean", value }]);
  };
  const text = (key: string, value: string | null) => {
    if (value !== null && value !== "") rows.push([key, { kind: "text", value }]);
  };

  if (result.fatal) {
    text("website.technical.analysis_failure_stage", result.fatal.stage);
    text("website.technical.analysis_failure_kind", result.fatal.failureKind ?? null);
    text("website.technical.analysis_failure_code", result.fatal.code ?? null);
    if (result.fatal.transient !== undefined) {
      boolean("website.technical.analysis_failure_transient", result.fatal.transient);
    }
  }

  if (result.lab) {
    number("website.performance.lighthouse_performance", result.lab.performance);
    number("website.accessibility.lighthouse_accessibility", result.lab.accessibility);
    number("website.seo.lighthouse_seo", result.lab.seo);
    number("website.performance.lighthouse_best_practices", result.lab.bestPractices);
    number("website.performance.lcp_ms", result.lab.largestContentfulPaintMs, "ms");
    number("website.performance.cls", result.lab.cumulativeLayoutShift);
    number("website.performance.tbt_ms", result.lab.totalBlockingTimeMs, "ms");
    number("website.performance.fcp_ms", result.lab.firstContentfulPaintMs, "ms");
    number("website.performance.speed_index_ms", result.lab.speedIndexMs, "ms");
  }
  if (result.mobile) {
    boolean("website.mobile.viewport_meta_present", result.mobile.viewportMetaPresent);
    boolean("website.mobile.horizontal_overflow", result.mobile.horizontalOverflow);
    boolean("website.mobile.navigation_present", result.mobile.navigationPresent);
  }
  if (result.technical) {
    boolean("website.technical.https", result.technical.https);
    number("website.technical.console_errors", result.technical.consoleErrors);
    number("website.technical.failed_requests", result.technical.failedRequests);
    number("website.technical.mixed_content_requests", result.technical.mixedContentRequests);
    boolean("website.technical.robots_txt_present", result.technical.robotsTxtPresent);
    boolean("website.technical.sitemap_present", result.technical.sitemapPresent);
    boolean("website.technical.favicon_present", result.technical.faviconPresent);
  }
  if (result.seo) {
    boolean("website.seo.title_present", result.seo.titlePresent);
    boolean("website.seo.meta_description_present", result.seo.metaDescriptionPresent);
    boolean("website.seo.canonical_present", result.seo.canonicalPresent);
    number("website.seo.h1_count", result.seo.h1Count);
    boolean("website.seo.indexable", result.seo.indexable);
    boolean("website.structured_data.present", result.seo.structuredDataPresent);
    if (result.seo.schemaTypes.length > 0) {
      rows.push(["website.structured_data.schema_types", { kind: "json", value: { types: result.seo.schemaTypes } }]);
    }
  }
  if (result.conversion) {
    boolean("website.conversion.phone_link_present", result.conversion.phoneLinkPresent);
    boolean("website.conversion.email_link_present", result.conversion.emailLinkPresent);
    boolean("website.conversion.contact_page_present", result.conversion.contactPagePresent);
    boolean("website.conversion.contact_form_present", result.conversion.contactFormPresent);
    boolean("website.conversion.quote_cta_present", result.conversion.quoteCtaPresent);
    boolean("website.conversion.booking_cta_present", result.conversion.bookingCtaPresent);
    boolean("website.conversion.visible_address_present", result.conversion.visibleAddressPresent);
  }
  if (result.content) {
    number("website.content.homepage_word_count", result.content.homepageWordCount);
    number("website.content.copyright_year", result.content.copyrightYear);
    boolean("website.content.services_page_present", result.content.servicesPagePresent);
    boolean("website.content.about_page_present", result.content.aboutPagePresent);
  }
  if (result.links) {
    number("website.links.checked", result.links.checked);
    number("website.links.broken", result.links.broken);
    number("website.links.redirecting", result.links.redirecting);
  }
  if (result.assets) {
    number("website.assets.failed_images", result.assets.failedImages);
    number("website.assets.failed_scripts", result.assets.failedScripts);
    number("website.assets.failed_stylesheets", result.assets.failedStylesheets);
  }
  if (result.platform) {
    text("website.platform.detected", result.platform.platform);
    if (result.platform.platform !== null) {
      text("website.platform.confidence", result.platform.confidence);
    }
  }
  return rows;
}
