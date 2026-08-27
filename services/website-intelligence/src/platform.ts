/**
 * Conservative deterministic CMS / site-builder detection.
 *
 * Strong fingerprints only; "unknown" is a first-class answer. Evidence is
 * recorded so an operator can audit why a platform was claimed.
 */

export interface PlatformDetection {
  platform: string | null;
  confidence: "high" | "medium" | "unknown";
  evidence: string[];
}

interface Fingerprint {
  platform: string;
  /** Substring found in raw HTML (high confidence). */
  htmlMarkers?: string[];
  /** meta[name=generator] prefix (high confidence). */
  generatorPrefixes?: string[];
  /** Substring in a loaded resource URL (medium confidence on its own). */
  resourceMarkers?: string[];
}

const FINGERPRINTS: Fingerprint[] = [
  {
    platform: "WordPress",
    htmlMarkers: ["/wp-content/", "/wp-includes/"],
    generatorPrefixes: ["wordpress"],
    resourceMarkers: ["/wp-content/", "/wp-includes/"],
  },
  {
    platform: "Wix",
    htmlMarkers: ["static.parastorage.com", "wix.com/website-builder"],
    generatorPrefixes: ["wix.com"],
    resourceMarkers: ["static.parastorage.com", "static.wixstatic.com"],
  },
  {
    platform: "Squarespace",
    htmlMarkers: ["static1.squarespace.com", "squarespace-cdn.com"],
    generatorPrefixes: ["squarespace"],
    resourceMarkers: ["squarespace-cdn.com", "static1.squarespace.com"],
  },
  {
    platform: "Shopify",
    htmlMarkers: ["cdn.shopify.com", "shopify.theme"],
    generatorPrefixes: ["shopify"],
    resourceMarkers: ["cdn.shopify.com"],
  },
  {
    platform: "Webflow",
    htmlMarkers: ["assets.website-files.com", "data-wf-site"],
    generatorPrefixes: ["webflow"],
    resourceMarkers: ["assets.website-files.com", "assets-global.website-files.com"],
  },
  {
    platform: "GoDaddy Website Builder",
    htmlMarkers: ["img1.wsimg.com", "websites.godaddy.com"],
    generatorPrefixes: ["godaddy"],
    resourceMarkers: ["img1.wsimg.com"],
  },
  {
    platform: "Duda",
    htmlMarkers: ["cdn-website.com/", "dudaone"],
    generatorPrefixes: ["duda"],
    resourceMarkers: ["lirp.cdn-website.com", "irp.cdn-website.com"],
  },
  {
    platform: "Drupal",
    htmlMarkers: ["/sites/default/files/"],
    generatorPrefixes: ["drupal"],
    resourceMarkers: ["/sites/default/files/"],
  },
  {
    platform: "Joomla",
    htmlMarkers: ["/media/jui/", "/media/system/js/"],
    generatorPrefixes: ["joomla"],
    resourceMarkers: ["/media/jui/"],
  },
];

export function detectPlatform(input: {
  html: string;
  generatorMeta: string | null;
  resourceUrls: string[];
}): PlatformDetection {
  const htmlLower = input.html.toLowerCase();
  const generator = input.generatorMeta?.toLowerCase() ?? "";
  const resources = input.resourceUrls.map((url) => url.toLowerCase());

  for (const fingerprint of FINGERPRINTS) {
    const evidence: string[] = [];
    if (fingerprint.generatorPrefixes?.some((prefix) => generator.startsWith(prefix) || generator.includes(prefix))) {
      if (generator !== "") evidence.push(`meta generator: "${input.generatorMeta}"`);
    }
    for (const marker of fingerprint.htmlMarkers ?? []) {
      if (htmlLower.includes(marker.toLowerCase())) evidence.push(`html contains "${marker}"`);
    }
    for (const marker of fingerprint.resourceMarkers ?? []) {
      const hit = resources.find((url) => url.includes(marker.toLowerCase()));
      if (hit && !evidence.some((entry) => entry.includes(marker))) evidence.push(`resource ${truncate(hit)}`);
    }
    if (evidence.length >= 2) return { platform: fingerprint.platform, confidence: "high", evidence: evidence.slice(0, 3) };
    if (evidence.length === 1) return { platform: fingerprint.platform, confidence: "medium", evidence };
  }
  return { platform: null, confidence: "unknown", evidence: [] };
}

function truncate(value: string): string {
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}
