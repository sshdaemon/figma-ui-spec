import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyDeclarations, buildTokens, parseThemeDeclarations } from '../src/catalogue/theme.ts';
import { indexTokens } from '../src/catalogue/typography.ts';
import { typographyVariants } from '../src/catalogue/variants.ts';
import { parseColor, sameColor, toHexString } from '../src/mapping/colors.ts';
import { ColorMatcher, matchRadius, matchSpacing, ShadowMatcher, TextMatcher, tokenKeyOf } from '../src/mapping/match.ts';
import { parseShadowList, sameShadowSet } from '../src/mapping/shadows.ts';

const tokens = buildTokens(
  applyDeclarations(
    parseThemeDeclarations(
      `@theme {
        --color-white: #fff;
        --color-gray-200: #e5e7eb;
        --color-ink-900: #1e2430;
        --color-lime-400: #4fc23a;
        --color-primary: var(--color-lime-400);
        --color-border: var(--color-gray-200);
        --color-overlay: #1e24304d;
        --font-display: Lexend;
        --font-body: 'Karla', sans-serif;
        --text-h6: 1.25rem;
        --text-base: 1rem;
        --text-base--line-height: calc(1.5 / 1);
        --font-weight-light: 300;
        --font-weight-bold: 700;
        --leading-tight: 1.25;
        --leading-normal: 1.5;
        --tracking-tight: 0.25px;
        --tracking-wide: 0.05em;
        --radius-md: 0.375rem;
        --spacing: 0.25rem;
        --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
        --shadow-xl: 0px 6px 20px #1e24300f;
      }`,
      'project',
    ),
  ),
  { rootPx: 16, fontFamilies: {} },
);
const index = indexTokens(tokens);
const variants = typographyVariants(
  'Heading',
  { base: 'font-display font-bold leading-tight', variants: { level: { '6': 'text-h6 tracking-tight' } }, defaults: {} },
  index,
  16,
);

test('parseColor reads hex, rgb and keywords; toHexString writes alpha only when needed', () => {
  assert.deepEqual(parseColor('#abc'), { r: 170, g: 187, b: 204, a: 1 });
  assert.deepEqual(parseColor('rgb(0 0 0 / 0.1)'), { r: 0, g: 0, b: 0, a: 0.1 });
  assert.deepEqual(parseColor('rgba(255, 255, 255, 50%)'), { r: 255, g: 255, b: 255, a: 0.5 });
  assert.equal(parseColor('oklch(70% 0.1 200)'), undefined);
  assert.ok(sameColor(parseColor('#1e2430') as never, parseColor('#1e2431') as never), 'one step of rounding is the same colour');
  assert.equal(toHexString({ r: 30, g: 36, b: 48, a: 0.3 }), '#1e24304d');
  assert.equal(tokenKeyOf('Body/small - bold'), 'body-small-bold');
});

test('ColorMatcher: same name and value, renamed, differs, translucent, transparent, missing', () => {
  const m = new ColorMatcher(tokens);
  assert.deepEqual(m.match('#e5e7eb', 'gray/200'), { status: 'same', code: 'gray-200', note: 'also border' });
  assert.deepEqual(m.match('#4fc23a', 'Action/primary'), { status: 'renamed', code: 'lime-400', note: 'also primary' });
  assert.deepEqual(m.match('#4fc23a'), { status: 'same', code: 'lime-400', note: 'also primary' });
  assert.deepEqual(m.match('#ffffff', 'gray/200'), {
    status: 'differs',
    code: 'white',
    note: 'code gray-200 is #e5e7eb, design #ffffff; use white',
  });
  assert.deepEqual(m.match('#0f0f0f', 'gray/200'), {
    status: 'differs',
    code: 'gray-200',
    note: 'code gray-200 is #e5e7eb, design #0f0f0f',
  });
  assert.deepEqual(m.match('#1e24304d'), { status: 'same', code: 'overlay' }, 'a translucent token with the exact value wins');
  assert.deepEqual(m.match('#1e243080'), { status: 'same', code: 'ink-900/50' });
  assert.deepEqual(m.match('#ffffff00'), { status: 'same', code: 'transparent' });
  assert.deepEqual(m.match('#123456'), { status: 'missing', code: 'ink-900', note: 'nearest #1e2430' });
});

test('TextMatcher: an exact component variant, classes from tokens, and missing parts', () => {
  const m = new TextMatcher(variants, tokens);
  assert.deepEqual(m.match({ family: 'Lexend', sizePx: 20, weight: 700, lineHeightPx: 25, letterSpacingPx: 0.25 }), {
    status: 'same',
    code: 'Heading level=6',
  });
  assert.deepEqual(m.match({ family: 'Lexend', sizePx: 20, weight: 700, lineHeightPx: 30, letterSpacingPx: 0.25 }), {
    status: 'classes',
    code: 'font-display text-h6 font-bold leading-normal tracking-tight',
    note: 'nearest Heading level=6: line height 30 vs 25',
  });
  assert.equal(
    m.match({ family: 'Karla', sizePx: 16, weight: 300, lineHeightPx: 24, letterSpacingPx: 0 }).code,
    'font-body text-base font-light',
    'the size brings its own line height',
  );
  assert.equal(
    m.match({ family: 'Karla', sizePx: 20, weight: 300, lineHeightPx: 20, letterSpacingPx: 1 }).code,
    'font-body text-h6 font-light leading-none tracking-wide',
    'em tracking at 20px is 1px',
  );
  const missing = m.match({ family: 'Inter', sizePx: 13, weight: 500, lineHeightPx: 17, letterSpacingPx: 0 });
  assert.equal(missing.status, 'missing');
  assert.match(missing.note ?? '', /^no token for family Inter, size 13px, weight 500, line height 17px; nearest Heading level=6/);
});

test('ShadowMatcher compares layered shadows in either order and says when the code differs', () => {
  const m = new ShadowMatcher(tokens);
  const md = [
    { kind: 'drop' as const, x: 0, y: 2, blur: 4, spread: -2, hex: '#0000001a' },
    { kind: 'drop' as const, x: 0, y: 4, blur: 6, spread: -1, hex: '#0000001a' },
  ];
  assert.deepEqual(m.match(md, 'shadow-md'), { status: 'same', code: 'shadow-md' });
  assert.deepEqual(m.match(md, 'elevation/low'), { status: 'renamed', code: 'shadow-md' });
  const differs = m.match([{ kind: 'drop', x: 0, y: 20, blur: 25, spread: -5, hex: '#0000001a' }], 'shadow-xl');
  assert.equal(differs.status, 'differs');
  assert.match(differs.note ?? '', /^code 0px 6px 20px #1e24300f vs design 0 20 25 -5 #0000001a$/);
  assert.equal(m.match([{ kind: 'inner', x: 0, y: 1, blur: 1, spread: 0, hex: '#000000' }], 'inset').status, 'missing');
});

test('parseShadowList reads CSS box-shadow lists and refuses what it cannot read', () => {
  assert.deepEqual(parseShadowList('inset 0 1px 2px #000, 0px 10px 30px rgba(0,0,0,.25)'), [
    { kind: 'inner', x: 0, y: 1, blur: 2, spread: 0, hex: '#000000' },
    { kind: 'drop', x: 0, y: 10, blur: 30, spread: 0, hex: '#00000040' },
  ]);
  assert.equal(parseShadowList('0 1px 2px var(--tw-shadow-color)'), undefined);
  assert.equal(parseShadowList('0 1em 2px #000'), undefined);
  const a = parseShadowList('0 1px 2px #000, 0 2px 4px #000') ?? [];
  assert.ok(sameShadowSet(a, a.toReversed()));
});

test('spacing steps and radius tokens', () => {
  assert.deepEqual(matchSpacing(16, 4, 'gap'), { status: 'same', code: 'gap-4' });
  assert.deepEqual(matchSpacing(10, 4, 'p'), { status: 'same', code: 'p-2.5' });
  assert.deepEqual(matchSpacing(7, 4, 'p'), { status: 'off-scale', code: 'p-[7px]', note: '1.75 steps of 4px' });
  assert.equal(matchSpacing(8, undefined, 'gap').status, 'missing');
  assert.deepEqual(matchRadius(6, tokens), { status: 'same', code: 'rounded-md' });
  assert.deepEqual(matchRadius(16777200, tokens), { status: 'same', code: 'rounded-full' });
  assert.deepEqual(matchRadius(5, tokens), { status: 'missing', code: 'rounded-md', note: 'nearest 6px' });
});

test('review fixes: renamed text, spacing leading, differs points at the matching token', () => {
  const text = new TextMatcher(variants, tokens);
  const h6 = { family: 'Lexend', sizePx: 20, weight: 700, lineHeightPx: 25, letterSpacingPx: 0.25 };
  assert.deepEqual(text.match(h6, 'Heading/Small'), { status: 'renamed', code: 'Heading level=6', note: 'design Heading/Small' });
  assert.equal(
    text.match({ family: 'Karla', sizePx: 16, weight: 300, lineHeightPx: 28, letterSpacingPx: 0 }).code,
    'font-body text-base font-light leading-7',
  );
  assert.equal(text.match({ family: 'Karla', sizePx: 16, weight: 300, lineHeightPx: 18.75, letterSpacingPx: 0 }).status, 'missing');

  const shadows = new ShadowMatcher(tokens);
  const md = [
    { kind: 'drop' as const, x: 0, y: 2, blur: 4, spread: -2, hex: '#0000001a' },
    { kind: 'drop' as const, x: 0, y: 4, blur: 6, spread: -1, hex: '#0000001a' },
  ];
  const differs = shadows.match(md, 'shadow-xl');
  assert.equal(differs.status, 'differs');
  assert.equal(differs.code, 'shadow-md', 'what to write is the token with the design value');
  assert.match(differs.note ?? '', /; use shadow-md$/);
});

test('font stacks and length line heights match like bare names and ratios', () => {
  const stackTokens = buildTokens(
    applyDeclarations(
      parseThemeDeclarations(
        `@theme {
          --font-inter: "Inter", sans-serif;
          --text-h4: 1.25rem;
          --text-h4--line-height: 1.875rem;
          --font-weight-bold: 700;
          --spacing: 0.25rem;
        }`,
        'project',
      ),
    ),
    { rootPx: 16, fontFamilies: {} },
  );
  const stackVariants = typographyVariants(
    'Heading',
    { base: 'font-inter font-bold', variants: { level: { '4': 'text-h4' } }, defaults: {} },
    indexTokens(stackTokens),
    16,
  );
  const m = new TextMatcher(stackVariants, stackTokens);
  const v = { family: 'Inter', sizePx: 20, weight: 700, lineHeightPx: 30, letterSpacingPx: 0 };
  assert.deepEqual(m.match(v), { status: 'same', code: 'Heading level=4' });
  assert.deepEqual(m.recipe(v).classes, ['font-inter', 'text-h4', 'font-bold'], 'the rem line height of text-h4 needs no leading class');
});
