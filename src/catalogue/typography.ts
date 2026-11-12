import { round, toEm, toPx, toRatio } from './theme.ts';
import type { Token, TokenKind, TypeStyle } from './types.ts';

export interface TokenIndex {
  get(kind: TokenKind, key: string): Token | undefined;
}

export function indexTokens(tokens: readonly Token[]): TokenIndex {
  const map = new Map(tokens.map((t) => [`${t.kind}:${t.key}`, t]));
  return { get: (kind, key) => map.get(`${kind}:${key}`) };
}

/** Tailwind's static line-height utility, which is not a theme variable. */
const STATIC_LEADING: Readonly<Record<string, number>> = { none: 1 };

/** `text-*` utilities that set alignment, wrapping or overflow, not type. */
const TEXT_LAYOUT = new Set(['left', 'center', 'right', 'justify', 'start', 'end', 'ellipsis', 'clip', 'wrap', 'nowrap', 'balance', 'pretty']);

/** `text-*` keywords that set colour without a theme variable. */
const TEXT_COLOR_KEYWORDS = new Set(['inherit', 'current', 'transparent']);

const TYPOGRAPHIC = /^(text|font|leading|tracking)-(.+)$/;

type Utility = 'text' | 'font' | 'leading' | 'tracking';

/** The style being built; letter spacing in `em` waits for the final size. */
interface Draft {
  family?: string;
  sizePx?: number | undefined;
  sizeLineHeightPx?: number | undefined;
  weight?: number;
  leading?: number;
  trackingPx?: number;
  trackingEm?: number;
}

/** What a class does: changes the draft, is known but not typographic (`ignore`), or is not explained (`unknown`). */
type Outcome = 'applied' | 'ignore' | 'unknown';

type Handler = (key: string, draft: Draft, index: TokenIndex, rootPx: number) => Outcome;

const HANDLERS: Readonly<Record<Utility, Handler>> = {
  text(key, draft, index, rootPx) {
    const size = index.get('text', key);
    if (size) {
      draft.sizePx = size.px;
      const lh = index.get('text-line-height', key);
      draft.sizeLineHeightPx = lh ? lineHeightOf(lh.value, size.px, rootPx) : undefined;
      return 'applied';
    }
    return index.get('color', key) || TEXT_COLOR_KEYWORDS.has(key) ? 'ignore' : 'unknown';
  },
  font(key, draft, index) {
    const weight = index.get('font-weight', key);
    if (weight) {
      draft.weight = Number(weight.value);
      return 'applied';
    }
    const family = index.get('font', key);
    if (!family) return 'unknown';
    draft.family = family.value;
    return 'applied';
  },
  leading(key, draft, index) {
    const token = index.get('leading', key);
    const ratio = token ? toRatio(token.value) : STATIC_LEADING[key];
    if (ratio === undefined) return 'unknown';
    draft.leading = ratio;
    return 'applied';
  },
  tracking(key, draft, index) {
    const token = index.get('tracking', key);
    if (token?.px !== undefined) {
      draft.trackingPx = token.px;
      delete draft.trackingEm;
      return 'applied';
    }
    const em = token ? toEm(token.value) : undefined;
    if (em === undefined) return 'unknown';
    draft.trackingEm = em;
    delete draft.trackingPx;
    return 'applied';
  },
};

export interface Resolution {
  readonly style: TypeStyle;
  /** Classes a theme variable or static utility explains. */
  readonly matched: string[];
  /** Typographic classes no token explains, for example `text-[13px]` or a misspelt name. */
  readonly unresolved: string[];
  /** Typographic classes behind a variant prefix (`md:text-h4`), which apply only in some states or sizes. */
  readonly conditional: string[];
}

/**
 * The style a list of classes gives text in plain Tailwind v4: within one property the later class wins,
 * and a `leading-*` class beats the line height a `text-*` size brings with it, whatever the order.
 */
export function resolveClasses(classes: readonly string[], index: TokenIndex, rootPx: number): Resolution {
  const draft: Draft = {};
  const matched: string[] = [];
  const unresolved: string[] = [];
  const conditional: string[] = [];
  for (const cls of classes) {
    const bare = cls.slice(cls.lastIndexOf(':') + 1);
    if (!isTypographic(bare)) continue;
    if (bare !== cls) {
      conditional.push(cls);
      continue;
    }
    const [, utility, key] = TYPOGRAPHIC.exec(cls) as RegExpExecArray;
    const outcome = HANDLERS[utility as Utility](key as string, draft, index, rootPx);
    if (outcome === 'applied') matched.push(cls);
    else if (outcome === 'unknown') unresolved.push(cls);
  }
  return { style: finish(draft), matched, unresolved, conditional };
}

function finish(d: Draft): TypeStyle {
  const lineHeightPx = d.leading !== undefined && d.sizePx !== undefined ? round(d.leading * d.sizePx) : d.sizeLineHeightPx;
  const letterSpacingPx = d.trackingEm !== undefined && d.sizePx !== undefined ? round(d.trackingEm * d.sizePx) : d.trackingPx;
  return {
    ...(d.family === undefined ? {} : { family: d.family }),
    ...(d.sizePx === undefined ? {} : { sizePx: d.sizePx }),
    ...(d.weight === undefined ? {} : { weight: d.weight }),
    ...(lineHeightPx === undefined ? {} : { lineHeightPx }),
    ...(letterSpacingPx === undefined ? {} : { letterSpacingPx }),
  };
}

function lineHeightOf(value: string, sizePx: number | undefined, rootPx: number): number | undefined {
  const ratio = toRatio(value);
  if (ratio !== undefined) return sizePx === undefined ? undefined : round(ratio * sizePx);
  return toPx(value, rootPx);
}

export function isTypographic(cls: string): boolean {
  const match = TYPOGRAPHIC.exec(cls);
  return match !== null && !(match[1] === 'text' && TEXT_LAYOUT.has(match[2] ?? ''));
}

export function splitClasses(value: string): string[] {
  return value.split(/\s+/).filter(Boolean);
}
