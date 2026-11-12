import { resolveClasses, splitClasses, type TokenIndex } from './typography.ts';
import type { TypographyVariant } from './types.ts';

/** A `cva(base, { variants, defaultVariants })` definition as written in source. */
export interface VariantDefinition {
  readonly base: string;
  readonly variants: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly defaults: Readonly<Record<string, string>>;
}

/**
 * One entry per value of every prop that sets typography: base classes, then the other props' defaults,
 * then that value's classes. Props with no typographic classes of their own (truncation, say) are left out.
 */
export function typographyVariants(component: string, def: VariantDefinition, index: TokenIndex, rootPx: number): TypographyVariant[] {
  const out: TypographyVariant[] = [];
  for (const [prop, values] of Object.entries(def.variants)) {
    for (const [value, classString] of Object.entries(values)) {
      const own = splitClasses(classString);
      const ownEffect = resolveClasses(own, index, rootPx);
      if (ownEffect.matched.length + ownEffect.unresolved.length + ownEffect.conditional.length === 0) continue;
      const defaults = Object.entries(def.defaults)
        .filter(([p]) => p !== prop)
        .flatMap(([p, v]) => splitClasses(def.variants[p]?.[v] ?? ''));
      const classes = [...splitClasses(def.base), ...defaults, ...own];
      const { style, unresolved, conditional } = resolveClasses(classes, index, rootPx);
      out.push({ component, prop, value, classes, style, unresolved, conditional });
    }
  }
  return out;
}
