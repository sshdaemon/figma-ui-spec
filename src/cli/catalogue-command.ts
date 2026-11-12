import { existsSync } from 'node:fs';
import path from 'node:path';
import { readThemeDeclarations } from '../adapters/css/theme-files.ts';
import { readCva } from '../adapters/ts/cva-reader.ts';
import { applyDeclarations, buildTokens } from '../catalogue/theme.ts';
import { indexTokens } from '../catalogue/typography.ts';
import type { Catalogue, Token, TokenKind, TypeStyle, TypographyVariant } from '../catalogue/types.ts';
import { typographyVariants } from '../catalogue/variants.ts';
import { ConfigError, type RepoConfig } from './config.ts';

export function buildCatalogue(config: RepoConfig): Catalogue {
  const inRepo = (rel: string): string => {
    const abs = path.resolve(config.root, rel);
    if (!existsSync(abs)) throw new ConfigError(`${abs} does not exist`);
    return abs;
  };
  const decls = readThemeDeclarations(config.theme.base ? inRepo(config.theme.base) : undefined, config.theme.files.map(inRepo));
  const options = { rootPx: config.theme.rootPx, fontFamilies: config.theme.fontFamilies };
  const tokens = buildTokens(applyDeclarations(decls), options);
  const index = indexTokens(tokens);
  const typography = config.typography.flatMap((t) => typographyVariants(t.component, readCva(inRepo(t.file), t.cva), index, options.rootPx));
  return { tokens, typography, protectedPaths: config.protectedPaths };
}

const SHOWN: readonly (readonly [TokenKind, string])[] = [
  ['font', 'Font families'],
  ['text', 'Text sizes'],
  ['font-weight', 'Font weights'],
  ['leading', 'Line heights'],
  ['tracking', 'Letter spacing'],
  ['spacing', 'Spacing unit'],
  ['radius', 'Radius'],
  ['shadow', 'Shadows'],
  ['color', 'Colours'],
];

export function renderCatalogue(c: Catalogue, all = false): string {
  const lines: string[] = ['Typography components'];
  for (const v of c.typography) lines.push(`  ${typographyLine(v)}`);
  if (c.typography.length === 0) lines.push('  (none configured)');
  for (const [kind, title] of all ? [...SHOWN, ['breakpoint', 'Breakpoints'] as const, ['other', 'Other'] as const] : SHOWN) {
    const tokens = c.tokens.filter((t) => t.kind === kind);
    if (tokens.length === 0) continue;
    lines.push('', `${title} (${tokens.length})`);
    for (const t of tokens) lines.push(`  ${tokenLine(t)}`);
  }
  lines.push('', 'Protected paths');
  for (const p of c.protectedPaths) lines.push(`  ${p}`);
  if (c.protectedPaths.length === 0) lines.push('  (none configured)');
  return `${lines.join('\n')}\n`;
}

function typographyLine(v: TypographyVariant): string {
  const name = `${v.component} ${v.prop}=${v.value}`.padEnd(22);
  const unresolved = v.unresolved.length > 0 ? `  unresolved: ${v.unresolved.join(' ')}` : '';
  const conditional = v.conditional.length > 0 ? `  conditional: ${v.conditional.join(' ')}` : '';
  return `${name} ${describeStyle(v.style)}${unresolved}${conditional}`;
}

export function describeStyle(s: TypeStyle): string {
  const parts = [
    s.family ?? '?',
    `${s.sizePx ?? '?'}px`,
    s.lineHeightPx === undefined ? undefined : `/${s.lineHeightPx}`,
    s.weight === undefined ? undefined : ` ${s.weight}`,
    s.letterSpacingPx ? ` tracking ${s.letterSpacingPx}px` : undefined,
  ];
  return `${parts[0]} ${parts.slice(1).filter(Boolean).join('')}`;
}

function tokenLine(t: Token): string {
  const key = (t.key || '(unit)').padEnd(24);
  const px = t.px !== undefined && !/^-?\d*\.?\d+px$/.test(t.value) ? ` (${t.px}px)` : '';
  const via = t.via.length > 0 ? `  via ${t.via.join(' → ')}` : '';
  const origin = t.origin === 'base' ? '  [framework default]' : '';
  return `${key} ${t.value}${px}${via}${origin}`;
}
