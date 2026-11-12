import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyDeclarations, buildTokens, classify, parseThemeDeclarations, stripComments, toEm, toPx, toRatio } from '../src/catalogue/theme.ts';

const options = { rootPx: 16, fontFamilies: { display: 'Comfortaa' } };

test('stripComments keeps comment-like text inside strings', () => {
  const css = '@source "dist/*.js"; /* gone */ @theme { --a: 1; } /* also gone */';
  assert.equal(stripComments(css), '@source "dist/*.js";  @theme { --a: 1; } ');
  assert.equal(stripComments("a: 'x/*y'; b"), "a: 'x/*y'; b");
});

test('parseThemeDeclarations reads only top-level custom properties of @theme blocks', () => {
  const css = `
    :root { --outside: 1px; }
    @theme default { --spacing: 0.25rem; }
    @theme inline {
      --color-fg: var(--color-black);
      --padding-1\\/2: 50%;
      @keyframes spin { to { --inside: 1; } }
      color: red;
    }
    @layer base { h1 { --not-theme: 2px; } }`;
  assert.deepEqual(
    parseThemeDeclarations(css, 'project').map((d) => [d.name, d.value]),
    [
      ['spacing', '0.25rem'],
      ['color-fg', 'var(--color-black)'],
      ['padding-1/2', '50%'],
    ],
  );
});

test('applyDeclarations lets later values win and namespace resets clear earlier ones', () => {
  const decls = [
    { name: 'color-red', value: '#f00', origin: 'base' as const },
    { name: 'colorful', value: 'keep', origin: 'base' as const },
    { name: 'text-sm', value: '0.875rem', origin: 'base' as const },
    { name: 'color-*', value: 'initial', origin: 'project' as const },
    { name: 'color-gray', value: '#eee', origin: 'project' as const },
    { name: 'text-sm', value: '14px', origin: 'project' as const },
  ];
  const map = applyDeclarations(decls);
  assert.deepEqual([...map.keys()], ['colorful', 'color-gray', 'text-sm']);
  assert.equal(map.get('text-sm')?.origin, 'project');
  assert.equal(applyDeclarations([...decls, { name: '*', value: 'initial', origin: 'project' }]).size, 0);
  assert.deepEqual([...applyDeclarations([...decls, { name: 'text-sm', value: 'initial', origin: 'project' }]).keys()], ['colorful', 'color-gray']);
});

test('a namespace reset keeps the sub-namespaces Tailwind exempts', () => {
  const base = ['font-sans', 'font-weight-bold', 'text-sm', 'text-shadow-xs', 'inset-shadow-sm', 'inset-x-0'].map((name) => ({ name, value: 'x', origin: 'base' as const }));
  const reset = ['font-*', 'text-*', 'inset-*'].map((name) => ({ name, value: 'initial', origin: 'project' as const }));
  assert.deepEqual([...applyDeclarations([...base, ...reset]).keys()], ['font-weight-bold', 'text-shadow-xs', 'inset-shadow-sm']);
});

test('classify maps Tailwind v4 namespaces to kinds and utility keys', () => {
  assert.deepEqual(classify('color-gray-200'), { kind: 'color', key: 'gray-200' });
  assert.deepEqual(classify('text-h1'), { kind: 'text', key: 'h1' });
  assert.deepEqual(classify('text-h1--line-height'), { kind: 'text-line-height', key: 'h1' });
  assert.deepEqual(classify('text-shadow-xs'), { kind: 'other', key: 'text-shadow-xs' });
  assert.deepEqual(classify('font-weight-bold'), { kind: 'font-weight', key: 'bold' });
  assert.deepEqual(classify('font-roboto'), { kind: 'font', key: 'roboto' });
  assert.deepEqual(classify('spacing'), { kind: 'spacing', key: '' });
  assert.deepEqual(classify('animate-spin'), { kind: 'other', key: 'animate-spin' });
});

test('buildTokens follows references, uses fallbacks and names runtime font variables from config', () => {
  const map = applyDeclarations(
    parseThemeDeclarations(
      `@theme {
        --color-black: #151b26;
        --color-fg: var(--color-black);
        --color-foreground: var(--color-fg);
        --color-primary: var(--color-missing, #57db45);
        --font-display: var(--font-display);
        --font-body: var(--font-body);
        --text-h1: 1.875rem;
      }`,
      'project',
    ),
  );
  const tokens = new Map(buildTokens(map, options).map((t) => [t.name, t]));
  assert.equal(tokens.get('color-foreground')?.value, '#151b26');
  assert.deepEqual(tokens.get('color-foreground')?.via, ['color-fg', 'color-black']);
  assert.equal(tokens.get('color-primary')?.value, '#57db45');
  assert.equal(tokens.get('font-display')?.value, 'Comfortaa');
  assert.equal(tokens.get('font-body')?.value, 'var(--font-body)', 'an unmapped runtime font stays as written');
  assert.equal(tokens.get('text-h1')?.px, 30);
});

test('toPx and toRatio understand the units themes use', () => {
  assert.equal(toPx('0.875rem', 16), 14);
  assert.equal(toPx('5.813rem', 16), 93.008);
  assert.equal(toPx('1.2px', 16), 1.2);
  assert.equal(toPx('0', 16), 0);
  assert.equal(toPx('1.5', 16), undefined);
  assert.equal(toPx('0.05em', 16), undefined);
  assert.equal(toEm('-0.025em'), -0.025);
  assert.equal(toEm('1px'), undefined);
  assert.equal(toRatio('1.25'), 1.25);
  assert.equal(toRatio('calc(1.25 / 0.875)'), 1.25 / 0.875);
  assert.equal(toRatio('2rem'), undefined);
});
