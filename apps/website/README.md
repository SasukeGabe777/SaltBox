# SaltBox Website

This is the production marketing website: a static-first Astro 6 + TypeScript port of the approved SaltBox marketing prototype.

## Development

Use Node.js 24 LTS and run commands from the repository root:

```text
pnpm install
pnpm dev:website
pnpm check
pnpm build
```

The app-level equivalents are `pnpm --filter @saltbox/website dev`, `check`, and `build`.

## Design reference

The authoritative visual, content, responsive, animation, and interaction reference is:

```text
reference/marketing-prototype/index.html
```

Do not modify that preserved artifact. Implementation modernization is not permission for visual redesign.

## Implementation notes

- Marketing pages are pre-rendered/static by default. Cloudflare deployment and bindings are intentionally absent.
- Browser behavior uses scoped vanilla TypeScript and native browser APIs; no client framework or animation library is installed.
- The favicon is copied from `saltbox-logo-suite/saltbox-favicon.svg`. The visible CSS-built mark is retained to match the prototype.
- Google Fonts supplies Bricolage Grotesque, Inter, and Space Mono with `display=swap`; no font binaries are redistributed.
- Pricing is presentation data and requires business review before launch.
- Statistical tooltip claims are marked in typed content for business/source review before launch.
- The quote form intentionally preserves the prototype's prefilled `mailto:` flow. A real lead submission service belongs to a later phase.
- Absolute canonical and Open Graph URLs will be emitted after an approved production `site` URL is configured.

## Faithful-port differences

- Keyboard focus rings and the skip link appear only during keyboard navigation.
- The accessible mobile menu manages focus, locks background scrolling, closes on Escape, and returns focus to its trigger.
- The quote fields use native labels, autocomplete, required name/email validation, and browser validation UI before opening the same prefilled email flow.
- Reduced-motion mode removes the long pinned-motion tracks, shows every process step as static content, stops auto-cycling, and keeps the portfolio directly scrollable.
- At widths up to 420px, the three About proof items may wrap to prevent the narrow-screen overflow identified in the prototype review.
- The mobile portfolio carousel sets `scroll-padding` so the initial snap keeps the first card at the 22px content inset; the prototype's mandatory snap pulls the first card flush against the viewport edge on load.
- The fictional demo's mock CTA button renders in Inter via `font: inherit`; the prototype leaves it on the browser-default button font (Arial), an inheritance artifact that also wraps its label at very narrow widths.

No other intentional visual differences were introduced. Browser screenshot comparison remains pending when a connected browser is available.
