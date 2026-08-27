/**
 * Hardened ephemeral browser session for untrusted websites.
 *
 * - fresh headless Chrome per site (never the operator's profile)
 * - primary site hosts IP-pinned via --host-resolver-rules (anti-rebinding)
 * - downloads denied, no persisted cookies/profile, no extensions
 * - request interception aborts navigations to unvalidated hosts and any
 *   request addressed to a private IP literal or blocked hostname
 * - honest UA: the real Chrome UA plus a SaltBox bot token
 */

import type { Browser, HTTPRequest, Page } from "puppeteer";
import { checkNavigationTarget, isObviouslyForbiddenHost, type UrlSafetyOptions } from "./url-safety.ts";
import { DESKTOP_VIEWPORT, INTELLIGENCE_UA_SUFFIX, NAVIGATION_TIMEOUT_MS } from "./version.ts";

export interface BrowserSessionOptions {
  pinnedHosts: Map<string, string[]>;
  safety: UrlSafetyOptions;
}

export interface BrowserSession {
  browser: Browser;
  newHardenedPage(): Promise<Page>;
  close(): Promise<void>;
}

export async function launchBrowserSession(options: BrowserSessionOptions): Promise<BrowserSession> {
  const puppeteer = (await import("puppeteer")).default;
  const resolverRules = [...options.pinnedHosts.entries()]
    .filter(([, addresses]) => addresses.length > 0)
    .map(([host, addresses]) => `MAP ${host} ${addresses[0]}`)
    .join(", ");

  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { ...DESKTOP_VIEWPORT },
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-sync",
      "--metrics-recording-only",
      "--mute-audio",
      ...(resolverRules !== "" ? [`--host-resolver-rules=${resolverRules}`] : []),
    ],
  });

  // Approved-navigation cache shared across this session's pages.
  const approvedHosts = new Set<string>([...options.pinnedHosts.keys()]);

  const newHardenedPage = async (): Promise<Page> => {
    const page = await browser.newPage();
    page.setDefaultTimeout(NAVIGATION_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    const defaultUa = await browser.userAgent();
    await page.setUserAgent(`${defaultUa} ${INTELLIGENCE_UA_SUFFIX}`);

    const client = await page.createCDPSession();
    await client.send("Browser.setDownloadBehavior", { behavior: "deny" });

    await page.setRequestInterception(true);
    page.on("request", (request: HTTPRequest) => {
      void screenRequest(request);
    });

    const screenRequest = async (request: HTTPRequest): Promise<void> => {
      try {
        const url = new URL(request.url());
        if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "data:" && url.protocol !== "about:") {
          await request.abort("blockedbyclient");
          return;
        }
        if (url.protocol === "data:" || url.protocol === "about:") {
          await request.continue();
          return;
        }
        const host = url.hostname.toLowerCase();
        if (!options.safety.allowPrivateNetworks && isObviouslyForbiddenHost(host)) {
          await request.abort("blockedbyclient");
          return;
        }
        if (request.isNavigationRequest() && !approvedHosts.has(host)) {
          // A navigation (redirect or link) to a host we have not validated:
          // resolve + verify before letting Chrome connect.
          const verdict = await checkNavigationTarget(url, options.safety);
          if (!verdict.ok) {
            await request.abort("blockedbyclient");
            return;
          }
          approvedHosts.add(host);
        }
        await request.continue();
      } catch {
        // Request may already be handled; never crash the interceptor.
      }
    };

    return page;
  };

  return {
    browser,
    newHardenedPage,
    close: async () => {
      try {
        await browser.close();
      } catch {
        /* already closed */
      }
    },
  };
}
