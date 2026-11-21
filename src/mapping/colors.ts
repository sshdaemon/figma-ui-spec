/** Colour as 0–255 channels and 0–1 alpha. */
export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const NAMED: Readonly<Record<string, string>> = { white: '#ffffff', black: '#000000', transparent: '#00000000' };

/** `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()` in either syntax, and a few keywords; undefined for anything else (oklch included). */
export function parseColor(input: string): Rgba | undefined {
  const value = input.trim().toLowerCase();
  const named = NAMED[value];
  if (named) return parseColor(named);
  const hex = /^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/.exec(value)?.[1];
  if (hex) return fromHex(hex);
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/.exec(value);
  if (!rgb) return undefined;
  const alpha = rgb[4];
  return {
    r: Number(rgb[1]),
    g: Number(rgb[2]),
    b: Number(rgb[3]),
    a: alphaOf(alpha),
  };
}

function alphaOf(alpha: string | undefined): number {
  if (alpha === undefined) return 1;
  return alpha.endsWith('%') ? Number(alpha.slice(0, -1)) / 100 : Number(alpha);
}

function fromHex(hex: string): Rgba {
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  const at = (i: number): number => Number.parseInt(full.slice(i, i + 2), 16);
  return { r: at(0), g: at(2), b: at(4), a: full.length === 8 ? Math.round((at(6) / 255) * 1000) / 1000 : 1 };
}

/** Same colour when every channel is within one step and alpha within 1%, which absorbs Figma's float rounding. */
export function sameColor(a: Rgba, b: Rgba): boolean {
  return Math.abs(a.r - b.r) <= 1 && Math.abs(a.g - b.g) <= 1 && Math.abs(a.b - b.b) <= 1 && Math.abs(a.a - b.a) <= 0.01;
}

/** Plain RGB distance with alpha weighted like a channel; good enough to rank a palette's nearest entries. */
export function colorDistance(a: Rgba, b: Rgba): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b, (a.a - b.a) * 255);
}

function byte(v: number): string {
  return Math.round(v).toString(16).padStart(2, '0');
}

export function toHexString(c: Rgba): string {
  return `#${byte(c.r)}${byte(c.g)}${byte(c.b)}${c.a < 1 ? byte(c.a * 255) : ''}`;
}
