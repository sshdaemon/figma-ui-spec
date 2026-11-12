/** What a theme variable is for, from its Tailwind v4 namespace. */
export type TokenKind =
  | 'color'
  | 'text'
  | 'text-line-height'
  | 'leading'
  | 'tracking'
  | 'font'
  | 'font-weight'
  | 'radius'
  | 'shadow'
  | 'spacing'
  | 'breakpoint'
  | 'other';

export type TokenOrigin = 'base' | 'project';

/** One theme variable after resets and `var()` references are applied. */
export interface Token {
  /** Variable name without the leading dashes, for example `color-gray-200`. */
  readonly name: string;
  readonly kind: TokenKind;
  /** The name as it appears in a utility class, for example `gray-200` in `bg-gray-200`. */
  readonly key: string;
  /** The declared value, for example `var(--color-orange-500)`. */
  readonly raw: string;
  /** The value with every reference followed, for example `#ffc82c`. */
  readonly value: string;
  /** Token names followed to reach `value`, nearest first. Empty for a literal. */
  readonly via: readonly string[];
  /** Pixels, for lengths that resolve to one. */
  readonly px?: number;
  readonly origin: TokenOrigin;
}

/** The typographic result of a list of classes. */
export interface TypeStyle {
  readonly family?: string;
  readonly sizePx?: number;
  readonly weight?: number;
  readonly lineHeightPx?: number;
  readonly letterSpacingPx?: number;
}

/** One value of one variant prop of a typography component, with the classes it ends up with. */
export interface TypographyVariant {
  readonly component: string;
  readonly prop: string;
  readonly value: string;
  readonly classes: readonly string[];
  readonly style: TypeStyle;
  /** Typographic classes no token explains, for example `text-[13px]` or a misspelt name. */
  readonly unresolved: readonly string[];
  /** Typographic classes behind a variant prefix (`md:text-h4`), left out of `style`. */
  readonly conditional: readonly string[];
}

export interface Catalogue {
  readonly tokens: readonly Token[];
  readonly typography: readonly TypographyVariant[];
  readonly protectedPaths: readonly string[];
}
