import type { Shadow } from '../design/types.ts';
import { parseColor, sameColor, toHexString } from './colors.ts';

/** A CSS `box-shadow` value as design shadows; undefined when a part cannot be read. */
export function parseShadowList(css: string): Shadow[] | undefined {
  const parts = splitTopLevel(css);
  const shadows: Shadow[] = [];
  for (const part of parts) {
    const shadow = parseOne(part);
    if (!shadow) return undefined;
    shadows.push(shadow);
  }
  return shadows;
}

function parseOne(part: string): Shadow | undefined {
  const inset = /\binset\b/.test(part);
  const colorMatch = /(rgba?\([^)]*\)|#[\da-f]{3,8}\b|\b(?:white|black|transparent)\b)/i.exec(part);
  const color = colorMatch ? parseColor(colorMatch[1] ?? '') : undefined;
  if (!colorMatch || !color) return undefined;
  const lengths = part
    .replace(colorMatch[0], '')
    .replace(/\binset\b/, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(px);
  if (lengths.length < 2 || lengths.length > 4 || lengths.some((l) => l === undefined)) return undefined;
  const [x = 0, y = 0, blur = 0, spread = 0] = lengths as number[];
  return { kind: inset ? 'inner' : 'drop', x, y, blur, spread, hex: toHexString(color) };
}

function px(value: string): number | undefined {
  const m = /^(-?\d*\.?\d+)(px)?$/.exec(value);
  if (!m) return undefined;
  return m[2] === 'px' || Number(m[1]) === 0 ? Number(m[1]) : undefined;
}

function splitTopLevel(css: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of css) {
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Same shadows in the same order, sizes within half a pixel and colours within rounding. */
export function sameShadows(a: readonly Shadow[], b: readonly Shadow[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((s, i) => sameShadow(s, b[i]));
}

function sameShadow(s: Shadow, t: Shadow | undefined): boolean {
  if (!t || s.kind !== t.kind) return false;
  const geometry = close(s.x, t.x) && close(s.y, t.y) && close(s.blur, t.blur) && close(s.spread, t.spread);
  const ca = parseColor(s.hex);
  const cb = parseColor(t.hex);
  return geometry && ca !== undefined && cb !== undefined && sameColor(ca, cb);
}

function close(p: number, q: number): boolean {
  return Math.abs(p - q) <= 0.5;
}

/** Order-independent comparison, since Figma lists layered shadows in the reverse of CSS. */
export function sameShadowSet(a: readonly Shadow[], b: readonly Shadow[]): boolean {
  return sameShadows(a, b) || sameShadows(a, b.toReversed());
}
