import assert from "node:assert/strict";
import { test } from "node:test";
import { selectPages } from "../src/page-selection.ts";
import { parseRobotsTxt, isPathAllowed, permissiveRobots } from "../src/robots.ts";

const HOME = "https://example-roofing.test/";

test("page selection picks contact, services, about, and locations by deterministic priority", () => {
  const selected = selectPages(
    HOME,
    [
      "/about-us",
      "/services/roofing",
      "/contact",
      "/locations",
      "/gallery",
      "/blog/some-post",
    ],
    permissiveRobots(),
  );
  assert.deepEqual(
    selected.map((page) => page.role),
    ["homepage", "contact", "services", "about", "locations"],
  );
  assert.equal(selected[1]?.url, "https://example-roofing.test/contact");
});

test("a homepage-only site selects exactly the homepage", () => {
  assert.deepEqual(
    selectPages(HOME, [], permissiveRobots()).map((page) => page.url),
    [HOME],
  );
});

test("external links, mailto, tel, downloads, and login areas are never selected", () => {
  const selected = selectPages(
    HOME,
    [
      "https://other-domain.test/contact",
      "mailto:info@example-roofing.test",
      "tel:+18015550100",
      "/brochure.pdf",
      "/login",
      "/checkout",
      "/wp-admin/",
      "javascript:void(0)",
    ],
    permissiveRobots(),
  );
  assert.deepEqual(selected.map((page) => page.url), [HOME]);
});

test("duplicate links collapse and the five-page cap holds with deterministic ordering", () => {
  const selected = selectPages(
    HOME,
    [
      "/contact",
      "/contact/",
      "/contact#form",
      "/services",
      "/about",
      "/locations",
      "/reviews",
      "/gallery",
      "/faq",
    ],
    permissiveRobots(),
  );
  assert.equal(selected.length, 5);
  const urls = selected.map((page) => page.url);
  assert.equal(new Set(urls).size, urls.length);
  // Deterministic: same input, same output.
  assert.deepEqual(
    selectPages(HOME, ["/contact", "/contact/", "/contact#form", "/services", "/about", "/locations", "/reviews", "/gallery", "/faq"], permissiveRobots()),
    selected,
  );
});

test("robots.txt disallow removes sub-page candidates but never the operator-requested homepage", () => {
  const robots = parseRobotsTxt("User-agent: *\nDisallow: /contact\nDisallow: /private/\n");
  assert.equal(isPathAllowed(robots, "/contact"), false);
  assert.equal(isPathAllowed(robots, "/services"), true);
  const selected = selectPages(HOME, ["/contact", "/services", "/about"], robots);
  assert.deepEqual(
    selected.map((page) => page.role),
    ["homepage", "services", "about"],
  );
});

test("robots parsing honors agent groups, wildcards, and longest-match allow", () => {
  const robots = parseRobotsTxt(
    "User-agent: googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /files/*.pdf$\nAllow: /files/public\nDisallow: /files/\n",
  );
  assert.equal(isPathAllowed(robots, "/anything"), true); // googlebot group does not apply
  assert.equal(isPathAllowed(robots, "/files/report.pdf"), false);
  assert.equal(isPathAllowed(robots, "/files/secret/doc"), false);
  assert.equal(isPathAllowed(robots, "/files/public/doc"), true);
});
