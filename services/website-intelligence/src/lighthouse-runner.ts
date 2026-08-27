/**
 * Lighthouse lab measurement on the (already validated, IP-pinned) homepage.
 * Runs Lighthouse's default mobile-emulated configuration on a fresh page in
 * the hardened browser; results are LAB measurements, never CrUX/field data.
 * A Lighthouse failure is an analyzer-stage failure and must not erase other
 * observations, so this returns a structured outcome instead of throwing.
 */

import type { Page } from "puppeteer";
import type { LabMetrics } from "./types.ts";
import { LIGHTHOUSE_TIMEOUT_MS } from "./version.ts";

export type LighthouseRunner = (
  page: Page,
  url: string,
) => Promise<{ ok: true; lab: LabMetrics; rawJson: string } | { ok: false; error: string }>;

export const runLighthouse: LighthouseRunner = async (page, url) => {
  try {
    const { default: lighthouse } = await import("lighthouse");
    const timeout = new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`Lighthouse exceeded ${LIGHTHOUSE_TIMEOUT_MS} ms`)), LIGHTHOUSE_TIMEOUT_MS),
    );
    const run = lighthouse(
      url,
      {
        output: "json",
        logLevel: "silent",
        onlyCategories: ["performance", "accessibility", "seo", "best-practices"],
      },
      undefined,
      page,
    );
    const result = await Promise.race([run, timeout]);
    if (!result?.lhr) return { ok: false, error: "Lighthouse produced no result" };
    const lhr = result.lhr;

    const score = (category: string): number | null => {
      const value = lhr.categories?.[category]?.score;
      return typeof value === "number" ? Math.round(value * 100) : null;
    };
    const metric = (audit: string): number | null => {
      const value = lhr.audits?.[audit]?.numericValue;
      return typeof value === "number" ? Math.round(value * 100) / 100 : null;
    };
    const accessibilityFailures = Object.values(lhr.audits ?? {})
      .filter(
        (audit) =>
          typeof audit.score === "number" &&
          audit.score < 0.9 &&
          audit.scoreDisplayMode === "binary" &&
          (lhr.categories?.accessibility?.auditRefs ?? []).some((ref) => ref.id === audit.id),
      )
      .slice(0, 8)
      .map((audit) => ({ id: audit.id, title: (audit.title ?? audit.id).slice(0, 120) }));

    const lab: LabMetrics = {
      performance: score("performance"),
      accessibility: score("accessibility"),
      seo: score("seo"),
      bestPractices: score("best-practices"),
      firstContentfulPaintMs: metric("first-contentful-paint"),
      largestContentfulPaintMs: metric("largest-contentful-paint"),
      totalBlockingTimeMs: metric("total-blocking-time"),
      cumulativeLayoutShift: metric("cumulative-layout-shift"),
      speedIndexMs: metric("speed-index"),
      accessibilityFailures,
    };
    return { ok: true, lab, rawJson: JSON.stringify(lhr) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};
