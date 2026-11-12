import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyDeclarations, buildTokens, parseThemeDeclarations } from '../src/catalogue/theme.ts';
import { indexTokens, isTypographic, resolveClasses } from '../src/catalogue/typography.ts';
import { typographyVariants } from '../src/catalogue/variants.ts';

const index = indexTokens(
  buildTokens(
    applyDeclarations(
      parseThemeDeclarations(
        `@theme {
          --font-display: Comfortaa;
          --color-gray-500: #6b7280;
          --text-h1: 2rem;
          --text-sm: 0.875rem;
          --text-sm--line-height: calc(1.25 / 0.875);
          --font-weight-light: 300;
          --font-weight-bold: 700;
          --leading-tight: 1.25;
          --tracking-wide: 1px;
          --tracking-tight: -0.025em;
        }`,
        'project',
      ),
    ),
    { rootPx: 16, fontFamilies: {} },
  ),
);

const resolve = (classes: string): ReturnType<typeof resolveClasses> => resolveClasses(classes.split(' '), index, 16);

test('resolveClasses turns classes into family, size, weight, line height and tracking', () => {
  assert.deepEqual(resolve('font-display text-h1 font-bold leading-tight tracking-wide').style, {
    family: 'Comfortaa',
    sizePx: 32,
    weight: 700,
    lineHeightPx: 40,
    letterSpacingPx: 1,
  });
});

test('later classes win per property', () => {
  assert.equal(resolve('font-bold font-light').style.weight, 300);
  assert.equal(resolve('text-sm text-h1').style.sizePx, 32);
});

test('a leading class beats the size line height in either order, and the size line height applies without one', () => {
  assert.equal(resolve('text-sm').style.lineHeightPx, 20);
  assert.equal(resolve('leading-tight text-sm').style.lineHeightPx, 17.5);
  assert.equal(resolve('text-sm leading-none').style.lineHeightPx, 14);
});

test('em letter spacing is taken against the final size, and a later px value replaces it', () => {
  assert.equal(resolve('tracking-tight text-h1').style.letterSpacingPx, -0.8);
  assert.equal(resolve('tracking-tight').style.letterSpacingPx, undefined);
  assert.equal(resolve('text-h1 tracking-tight tracking-wide').style.letterSpacingPx, 1);
  assert.equal(resolve('text-h1 tracking-wide tracking-tight').style.letterSpacingPx, -0.8);
});

test('classes behind a variant prefix are conditional, not applied or unresolved', () => {
  const r = resolve('text-sm md:text-h1 hover:font-bold md:p-4 lg:text-center');
  assert.equal(r.style.sizePx, 14);
  assert.deepEqual(r.conditional, ['md:text-h1', 'hover:font-bold']);
  assert.deepEqual(r.unresolved, []);
});

test('colour and layout text utilities are not typography; unknown typographic classes are reported', () => {
  const { style, unresolved } = resolve('text-gray-500 text-ellipsis text-center text-[13px] font-heavy p-4');
  assert.deepEqual(style, {});
  assert.deepEqual(unresolved, ['text-[13px]', 'font-heavy']);
  assert.equal(isTypographic('text-ellipsis'), false);
  assert.equal(isTypographic('text-h1'), true);
});

test('typographyVariants combines base, other props defaults and each value, and skips props with no type classes', () => {
  const variants = typographyVariants(
    'Body',
    {
      base: 'font-display',
      variants: {
        size: { sm: 'text-sm font-light', lg: 'text-h1' },
        strong: { true: 'font-bold' },
        inline: { true: 'leading-none' },
        responsive: { true: 'md:text-h1' },
        truncate: { end: 'overflow-hidden text-ellipsis' },
      },
      defaults: { size: 'sm' },
    },
    index,
    16,
  );
  assert.deepEqual(
    variants.map((v) => [`${v.prop}=${v.value}`, v.style.sizePx, v.style.weight, v.style.lineHeightPx]),
    [
      ['size=sm', 14, 300, 20],
      ['size=lg', 32, undefined, undefined],
      ['strong=true', 14, 700, 20],
      ['inline=true', 14, 300, 14],
      ['responsive=true', 14, 300, 20],
    ],
  );
});
