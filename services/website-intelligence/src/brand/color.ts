/**
 * Deterministic color math for brand palette derivation: parsing, WCAG
 * contrast, HSL inspection, perceptual-ish distance, and safe adjustment.
 * No dependencies; every function is pure.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parse #rgb/#rrggbb/#rrggbbaa, rgb()/rgba(). Returns null for anything unusable (transparent, named, gradients). */
export function parseColor(input: string): Rgb | null {
  const value = input.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value);
  if (hex) {
    const raw = hex[1]!;
    if (raw.length === 3) {
      return { r: parseInt(raw[0]! + raw[0]!, 16), g: parseInt(raw[1]! + raw[1]!, 16), b: parseInt(raw[2]! + raw[2]!, 16) };
    }
    if (raw.length === 8) {
      const alpha = parseInt(raw.slice(6, 8), 16);
      if (alpha < 128) return null;
    }
    return { r: parseInt(raw.slice(0, 2), 16), g: parseInt(raw.slice(2, 4), 16), b: parseInt(raw.slice(4, 6), 16) };
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(value);
  if (rgb) {
    const alphaRaw = rgb[4];
    if (alphaRaw !== undefined) {
      const alpha = alphaRaw.endsWith("%") ? Number(alphaRaw.slice(0, -1)) / 100 : Number(alphaRaw);
      if (Number.isFinite(alpha) && alpha < 0.5) return null;
    }
    const channel = (raw: string) => Math.min(255, Number(raw));
    return { r: channel(rgb[1]!), g: channel(rgb[2]!), b: channel(rgb[3]!) };
  }
  return null;
}

export function toHex(color: Rgb): string {
  const part = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${part(color.r)}${part(color.g)}${part(color.b)}`;
}

/** WCAG relative luminance (0..1). */
export function luminance(color: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/** WCAG contrast ratio (1..21). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [dark, light] = la < lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export function toHsl(color: Rgb): Hsl {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

export function fromHsl(hsl: Hsl): Rgb {
  const h = ((hsl.h % 360) + 360) % 360 / 360;
  const { s, l } = hsl;
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t0: number) => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return {
    r: Math.round(channel(h + 1 / 3) * 255),
    g: Math.round(channel(h) * 255),
    b: Math.round(channel(h - 1 / 3) * 255),
  };
}

/** Simple RGB distance (0..~441) for near-duplicate rejection. */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

/** A color usable as a brand primary/accent: not near-white/black/grey. */
export function isBrandable(color: Rgb): boolean {
  const { s, l } = toHsl(color);
  if (l > 0.92 || l < 0.08) return false;
  return s >= 0.15;
}

/** Darken (positive amount) or lighten (negative) toward usable contrast. */
export function adjustLightness(color: Rgb, delta: number): Rgb {
  const hsl = toHsl(color);
  return fromHsl({ ...hsl, l: Math.min(1, Math.max(0, hsl.l + delta)) });
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const NEAR_BLACK: Rgb = { r: 26, g: 30, b: 36 };

/** White or near-black, whichever passes AA (>=4.5) on the given background; prefers white. */
export function readableTextOn(background: Rgb): Rgb {
  if (contrastRatio(background, WHITE) >= 4.5) return WHITE;
  return NEAR_BLACK;
}

/**
 * Deterministically deepen a color until white text reaches AA contrast on
 * it (max 8 steps). Used so an extracted mid-tone brand color can safely be
 * a button/hero background.
 */
export function ensureContrastWithWhite(color: Rgb): Rgb {
  let current = color;
  for (let step = 0; step < 8; step += 1) {
    if (contrastRatio(current, WHITE) >= 4.5) return current;
    current = adjustLightness(current, -0.06);
  }
  return current;
}
