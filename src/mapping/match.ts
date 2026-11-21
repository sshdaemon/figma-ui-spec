import type { Token, TypographyVariant } from '../catalogue/types.ts';
import { toEm, toRatio } from '../catalogue/theme.ts';
import type { Shadow } from '../design/types.ts';
import { colorDistance, parseColor, sameColor, toHexString, type Rgba } from './colors.ts';
import { parseShadowList, sameShadowSet } from './shadows.ts';
import type { TextValue } from './usage.ts';

/**
 * How a design value relates to the code:
 * - `same`: a token or component variant with the same value (and the same name, where the design has one);
 * - `renamed`: the value exists in code under another name;
 * - `classes`: no component variant fits, but theme tokens cover every part, so classes can build it;
 * - `differs`: the code has the name with another value;
 * - `off-scale`: a size no step of the theme's scale gives;
 * - `missing`: nothing in code has the value; `code` holds the nearest option.
 */
export type MatchStatus = 'same' | 'renamed' | 'classes' | 'differs' | 'off-scale' | 'missing';

export interface Match {
  readonly status: MatchStatus;
  /** What to write in code: a utility class, classes, or a component and variant. */
  readonly code: string;
  readonly note?: string;
  /** On `differs`: the token that has the design's value, when one does. */
  readonly sameValue?: string;
}

const PX_TOLERANCE = 0.05;
const RATIO_TOLERANCE = 0.005;

/** `gray/200` → `gray-200`, `White` → `white`, `Body/small - bold` → `body-small-bold`. */
export function tokenKeyOf(designName: string): string {
  return designName
    .toLowerCase()
    .replace(/[^a-z\d]+/g, '-')
    .replace(/^-|-$/g, '');
}

interface ColorToken {
  readonly token: Token;
  readonly rgba: Rgba;
}

export class ColorMatcher {
  private readonly tokens: readonly ColorToken[];

  constructor(tokens: readonly Token[]) {
    this.tokens = tokens.flatMap((token) => {
      if (token.kind !== 'color') return [];
      const rgba = parseColor(token.value);
      return rgba ? [{ token, rgba }] : [];
    });
  }

  /** A translucent colour matches by its RGB and gets Tailwind's opacity modifier (`ink-900/30`); fully transparent is `transparent`. */
  match(hex: string, styleName?: string): Match {
    const rgba = parseColor(hex);
    if (!rgba) return { status: 'missing', code: '', note: `cannot read ${hex}` };
    if (rgba.a === 0) return { status: 'same', code: 'transparent' };
    if (rgba.a < 1 && !this.tokens.some((t) => sameColor(t.rgba, rgba))) {
      const opaque = this.matchOpaque({ ...rgba, a: 1 }, styleName);
      const percent = Math.round(rgba.a * 100);
      return opaque.status === 'missing' || !opaque.code ? opaque : { ...opaque, code: `${opaque.code}/${percent}` };
    }
    return this.matchOpaque(rgba, styleName);
  }

  /** Tokens with exactly this colour; a translucent colour also gets its opaque tokens with an opacity suffix. */
  candidates(hex: string): { key: string; token: Token }[] {
    const rgba = parseColor(hex);
    if (!rgba) return [];
    const exact = this.tokens.filter((t) => sameColor(t.rgba, rgba)).map((t) => ({ key: t.token.key, token: t.token }));
    if (exact.length > 0 || rgba.a === 1) return exact;
    const percent = Math.round(rgba.a * 100);
    return this.tokens
      .filter((t) => sameColor(t.rgba, { ...rgba, a: 1 }))
      .map((t) => ({ key: `${t.token.key}/${percent}`, token: t.token }));
  }

  private matchOpaque(rgba: Rgba, styleName: string | undefined): Match {
    const hex = toHexString(rgba);
    const sameValue = this.tokens.filter((t) => sameColor(t.rgba, rgba)).map((t) => t.token);
    const named = styleName === undefined ? undefined : this.tokens.find((t) => t.token.key === tokenKeyOf(styleName));
    if (named && sameColor(named.rgba, rgba)) return { status: 'same', code: named.token.key, ...alsoNote(sameValue, named.token) };
    if (named) {
      // `code` is what to write: the token with the design's value when there is one, not the same-named one.
      const instead = preferred(sameValue);
      const note = `code ${named.token.key} is ${named.token.value}, design ${hex}${instead ? `; use ${instead.key}` : ''}`;
      return { status: 'differs', code: instead?.key ?? named.token.key, note };
    }
    const best = preferred(sameValue);
    if (best) return { status: styleName === undefined ? 'same' : 'renamed', code: best.key, ...alsoNote(sameValue, best) };
    const nearest = this.tokens
      .filter((t) => t.rgba.a === 1)
      .toSorted((a, b) => colorDistance(a.rgba, rgba) - colorDistance(b.rgba, rgba))[0];
    return { status: 'missing', code: nearest?.token.key ?? '', note: nearest ? `nearest ${nearest.token.value}` : 'no colour tokens' };
  }
}

/** Palette entries before aliases, project before framework, so `lime-400` wins over `primary`. */
function preferred(tokens: readonly Token[]): Token | undefined {
  return tokens.toSorted((a, b) => rank(a) - rank(b))[0];
}

function rank(t: Token): number {
  return (t.via.length > 0 ? 2 : 0) + (t.origin === 'base' ? 1 : 0);
}

function alsoNote(all: readonly Token[], chosen: Token): { note?: string } {
  const others = all.filter((t) => t !== chosen);
  return others.length > 0 ? { note: `also ${names(others)}` } : {};
}

function names(tokens: readonly Token[]): string {
  return tokens.map((t) => t.key).join(', ');
}

/** Classes for a text: from tokens, with the parts no token gives filled in two ways, by the nearest token and by the exact value. */
export interface Recipe {
  readonly classes: string[];
  readonly missing: string[];
  readonly nearest: string[];
  readonly exact: string[];
}

export class TextMatcher {
  private readonly variants: readonly TypographyVariant[];
  private readonly tokens: readonly Token[];

  constructor(variants: readonly TypographyVariant[], tokens: readonly Token[]) {
    this.variants = variants;
    this.tokens = tokens;
  }

  /** A styled text that matches a variant exactly is `renamed`, since text style names never match component names. */
  match(v: TextValue, styleName?: string): Match {
    const exact = this.variants.find((x) => differences(v, x).length === 0);
    if (exact && styleName) return { status: 'renamed', code: variantName(exact), note: `design ${styleName}` };
    if (exact) return { status: 'same', code: variantName(exact) };
    const recipe = this.recipe(v);
    const nearest = this.nearestVariant(v);
    const nearestNote = nearest ? `nearest ${variantName(nearest)}: ${differences(v, nearest).join(', ')}` : undefined;
    if (recipe.missing.length === 0) {
      return { status: 'classes', code: recipe.classes.join(' '), ...(nearestNote ? { note: nearestNote } : {}) };
    }
    const missing = `no token for ${recipe.missing.join(', ')}`;
    return { status: 'missing', code: recipe.classes.join(' '), note: nearestNote ? `${missing}; ${nearestNote}` : missing };
  }

  /** Utility classes for the text, from theme tokens only; parts no token gives are listed as missing. */
  recipe(v: TextValue): Recipe {
    const out: Recipe = { classes: [], missing: [], nearest: [], exact: [] };
    const pick = (cls: string | undefined, label: string, nearest: string | undefined, exact: string): void => {
      if (cls) {
        out.classes.push(cls);
        out.nearest.push(cls);
        out.exact.push(cls);
        return;
      }
      out.missing.push(label);
      if (nearest) out.nearest.push(nearest);
      out.exact.push(exact);
    };
    const family = this.find('font', (t) => firstFamily(t.value) === v.family.toLowerCase(), 'font');
    pick(family, `family ${v.family}`, undefined, `font-['${v.family.replace(/\s+/g, '_')}']`);
    const size = this.tokens.find((t) => t.kind === 'text' && t.px !== undefined && Math.abs(t.px - v.sizePx) <= PX_TOLERANCE);
    pick(
      size ? `text-${size.key}` : undefined,
      `size ${v.sizePx}px`,
      this.closest('text', 'text', (t) => t.px, v.sizePx),
      `text-[${v.sizePx}px]`,
    );
    const weight = this.find('font-weight', (t) => Number(t.value) === v.weight, 'font');
    pick(
      weight,
      `weight ${v.weight}`,
      this.closest('font-weight', 'font', (t) => Number(t.value), v.weight),
      `font-[${v.weight}]`,
    );
    const leading = this.leadingClass(v, size);
    if (leading !== null) {
      const ratio = v.lineHeightPx / v.sizePx;
      pick(
        leading,
        `line height ${v.lineHeightPx}px`,
        this.closest('leading', 'leading', (t) => toRatio(t.value), ratio),
        `leading-[${v.lineHeightPx}px]`,
      );
    }
    if (Math.abs(v.letterSpacingPx) > PX_TOLERANCE) {
      const tracking = this.find(
        'tracking',
        (t) => Math.abs((trackingPx(t, v.sizePx) ?? Number.NaN) - v.letterSpacingPx) <= PX_TOLERANCE,
        'tracking',
      );
      const near = this.closest('tracking', 'tracking', (t) => trackingPx(t, v.sizePx), v.letterSpacingPx);
      pick(tracking, `letter spacing ${v.letterSpacingPx}px`, near, `tracking-[${v.letterSpacingPx}px]`);
    }
    return out;
  }

  /** The token of a kind whose number is closest to `target`, as a class. */
  private closest(kind: Token['kind'], prefix: string, value: (t: Token) => number | undefined, target: number): string | undefined {
    const scored = this.tokens.flatMap((t) => {
      const n = t.kind === kind ? value(t) : undefined;
      return n === undefined || Number.isNaN(n) ? [] : [{ t, d: Math.abs(n - target) }];
    });
    const best = scored.toSorted((a, b) => a.d - b.d)[0];
    return best ? `${prefix}-${best.t.key}` : undefined;
  }

  /** A leading class, `null` when the size's own line height already gives it, undefined when no token does. */
  private leadingClass(v: TextValue, size: Token | undefined): string | null | undefined {
    const companion = size ? this.tokens.find((t) => t.kind === 'text-line-height' && t.key === size.key) : undefined;
    if (companion && Math.abs((companionPx(companion, v.sizePx) ?? Number.NaN) - v.lineHeightPx) <= PX_TOLERANCE) return null;
    const ratio = v.lineHeightPx / v.sizePx;
    const named = this.find('leading', (t) => Math.abs((toRatio(t.value) ?? Number.NaN) - ratio) <= RATIO_TOLERANCE, 'leading');
    if (named) return named;
    if (Math.abs(ratio - 1) <= RATIO_TOLERANCE) return 'leading-none';
    // Tailwind v4 also takes `leading-<n>` as n steps of the spacing unit.
    const unit = this.tokens.find((t) => t.kind === 'spacing')?.px;
    const step = matchSpacing(v.lineHeightPx, unit, 'leading');
    return step.status === 'same' ? step.code : undefined;
  }

  private find(kind: Token['kind'], test: (t: Token) => boolean, prefix: string): string | undefined {
    const t = this.tokens.find((x) => x.kind === kind && test(x));
    return t ? `${prefix}-${t.key}` : undefined;
  }

  /** The closest variant with the same family and size, which is what a text conflict offers as nearest. */
  sameFace(v: TextValue): { name: string; differences: string[] } | undefined {
    const candidates = this.variants
      .map((variant) => ({ name: variantName(variant), differences: differences(v, variant) }))
      .filter((c) => !c.differences.some((d) => d.startsWith('family') || d.startsWith('size')));
    return candidates.toSorted((a, b) => a.differences.length - b.differences.length)[0];
  }

  /** The closest component variant and how it differs, for deciding whether a near match is worth a conflict. */
  nearest(v: TextValue): { variant: TypographyVariant; name: string; differences: string[] } | undefined {
    const variant = this.nearestVariant(v);
    return variant ? { variant, name: variantName(variant), differences: differences(v, variant) } : undefined;
  }

  private nearestVariant(v: TextValue): TypographyVariant | undefined {
    return this.variants.filter((x) => x.style.sizePx !== undefined).toSorted((a, b) => score(v, a) - score(v, b))[0];
  }
}

function score(v: TextValue, x: TypographyVariant): number {
  return Math.abs((x.style.sizePx ?? 0) - v.sizePx) * 10 + differences(v, x).length;
}

/** What differs between a design text and a code variant, as short phrases. */
export function differences(v: TextValue, x: TypographyVariant): string[] {
  const s = x.style;
  const out: string[] = [];
  const px = (label: string, design: number, code: number | undefined): void => {
    if (code === undefined || Math.abs(design - code) > PX_TOLERANCE) out.push(`${label} ${design} vs ${code ?? '?'}`);
  };
  if (firstFamily(s.family ?? '') !== v.family.toLowerCase()) out.push(`family ${v.family} vs ${s.family ?? '?'}`);
  px('size', v.sizePx, s.sizePx);
  if (s.weight !== v.weight) out.push(`weight ${v.weight} vs ${s.weight ?? '?'}`);
  px('line height', v.lineHeightPx, s.lineHeightPx);
  px('letter spacing', v.letterSpacingPx, s.letterSpacingPx ?? 0);
  return out;
}

export function variantName(x: TypographyVariant): string {
  return `${x.component} ${x.prop}=${x.value}`;
}

function firstFamily(value: string): string {
  return (value.split(',')[0] ?? '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .toLowerCase();
}

/** A size's own line height in px, whether the theme writes it as a ratio or as a length. */
function companionPx(t: Token, sizePx: number): number | undefined {
  if (t.px !== undefined) return t.px;
  const ratio = toRatio(t.value);
  return ratio === undefined ? undefined : ratio * sizePx;
}

function trackingPx(t: Token, sizePx: number): number | undefined {
  if (t.px !== undefined) return t.px;
  const em = toEm(t.value);
  return em === undefined ? undefined : em * sizePx;
}

export class ShadowMatcher {
  private readonly tokens: readonly { token: Token; shadows: readonly Shadow[] }[];

  constructor(tokens: readonly Token[]) {
    this.tokens = tokens.flatMap((token) => {
      if (token.kind !== 'shadow') return [];
      const shadows = parseShadowList(token.value);
      return shadows ? [{ token, shadows }] : [];
    });
  }

  match(shadows: readonly Shadow[], styleName: string): Match {
    const key = tokenKeyOf(styleName).replace(/^shadow-/, '');
    const named = this.tokens.find((t) => t.token.key === key);
    const sameValue = this.tokens.find((t) => sameShadowSet(t.shadows, shadows));
    if (named && sameShadowSet(named.shadows, shadows)) return { status: 'same', code: `shadow-${key}` };
    if (named) {
      const alt = sameValue ? `; use shadow-${sameValue.token.key}` : '';
      return {
        status: 'differs',
        code: `shadow-${sameValue?.token.key ?? key}`,
        note: `code ${named.token.value} vs design ${describeShadows(shadows)}${alt}`,
        ...(sameValue ? { sameValue: `shadow-${sameValue.token.key}` } : {}),
      };
    }
    if (sameValue) return { status: 'renamed', code: `shadow-${sameValue.token.key}` };
    return { status: 'missing', code: '', note: describeShadows(shadows) };
  }
}

export function describeShadows(shadows: readonly Shadow[]): string {
  return shadows.map((s) => `${s.kind === 'inner' ? 'inset ' : ''}${s.x} ${s.y} ${s.blur} ${s.spread} ${s.hex}`).join(', ');
}

/** `gap-4` for 16px on a 4px scale; whole and half steps count as on the scale. */
export function matchSpacing(px: number, unitPx: number | undefined, prefix: string): Match {
  if (!unitPx) return { status: 'missing', code: `${prefix}-[${px}px]`, note: 'no spacing unit in the theme' };
  const step = px / unitPx;
  if (Number.isInteger(step * 2)) return { status: 'same', code: `${prefix}-${step}` };
  return { status: 'off-scale', code: `${prefix}-[${px}px]`, note: `${step} steps of ${unitPx}px` };
}

export function matchRadius(px: number, tokens: readonly Token[]): Match {
  const radii = tokens.filter((t) => t.kind === 'radius' && t.px !== undefined);
  const same = radii.find((t) => Math.abs((t.px ?? 0) - px) <= PX_TOLERANCE);
  if (same) return { status: 'same', code: `rounded-${same.key}` };
  if (px >= 999) return { status: 'same', code: 'rounded-full' };
  const nearest = radii.toSorted((a, b) => Math.abs((a.px ?? 0) - px) - Math.abs((b.px ?? 0) - px))[0];
  return {
    status: 'missing',
    code: nearest ? `rounded-${nearest.key}` : `rounded-[${px}px]`,
    note: nearest ? `nearest ${nearest.px}px` : 'no radius tokens',
  };
}
