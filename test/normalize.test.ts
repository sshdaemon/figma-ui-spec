import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeFrame, toHex } from '../src/design/normalize.ts';
import { entry, node, solid } from './figma-builders.ts';

test('normalizeFrame keeps layout, paints, radius, shadows and positions relative to the frame', () => {
  const frame = node(
    'FRAME',
    '1:1',
    'Modal',
    {
      layoutMode: 'VERTICAL',
      itemSpacing: 16,
      paddingTop: 24,
      paddingLeft: 24,
      primaryAxisAlignItems: 'CENTER',
      fills: [solid(1, 1, 1), solid(0, 0, 0, 1, { visible: false }), { type: 'IMAGE' }],
      strokes: [solid(0.898, 0.906, 0.922)],
      strokeWeight: 1,
      cornerRadius: 12,
      effects: [
        { type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.1 }, offset: { x: 0, y: 4 }, radius: 6, spread: -1 },
        { type: 'LAYER_BLUR', radius: 4 },
      ],
      opacity: 0.5,
      children: [
        node('RECTANGLE', '1:2', 'Pill', { rectangleCornerRadii: [4, 4, 0, 0] }, [1010, 2020, 50, 20]),
        node('RECTANGLE', '1:3', 'Square', { rectangleCornerRadii: [6, 6, 6, 6] }, [1000, 2000, 10, 10]),
        node('FRAME', '1:4', 'Old', { visible: false, children: [node('TEXT', '1:5', 'x')] }),
      ],
    },
    [1000, 2000, 400, 300],
  );
  const { node: n, hidden } = normalizeFrame(entry(frame));
  assert.equal(hidden, 2);
  assert.deepEqual(n.box, { x: 0, y: 0, w: 400, h: 300 });
  assert.deepEqual(n.layout, { direction: 'column', gap: 16, padding: [24, 0, 0, 24], wrap: false, mainAlign: 'center' });
  assert.deepEqual(n.fills, [{ kind: 'solid', hex: '#ffffff' }, { kind: 'image' }]);
  assert.deepEqual(n.strokes, [{ kind: 'solid', hex: '#e5e7eb' }]);
  assert.equal(n.strokeWeight, 1);
  assert.equal(n.radius, 12);
  assert.deepEqual(n.shadows, [{ kind: 'drop', x: 0, y: 4, blur: 6, spread: -1, hex: '#0000001a' }]);
  assert.equal(n.opacity, 0.5);
  assert.deepEqual(n.children?.map((c) => [c.id, c.box, c.radius]), [
    ['1:2', { x: 10, y: 20, w: 50, h: 20 }, [4, 4, 0, 0]],
    ['1:3', { x: 0, y: 0, w: 10, h: 10 }, 6],
  ]);
});

test('normalizeFrame resolves style names, variable ids, text and component instances', () => {
  const frame = node('FRAME', '1:1', 'Card', {
    styles: { fills: 's1', stroke: 's2', effect: 's9' },
    boundVariables: {
      itemSpacing: { type: 'VARIABLE_ALIAS', id: 'VariableID:a/1' },
      fills: [{ type: 'VARIABLE_ALIAS', id: 'VariableID:b/2' }],
      rectangleCornerRadii: { RECTANGLE_TOP_LEFT_CORNER_RADIUS: { type: 'VARIABLE_ALIAS', id: 'VariableID:c/3' } },
    },
    children: [
      node('TEXT', '1:2', 'Heading', {
        characters: 'Select data',
        style: { fontFamily: 'Roboto', fontWeight: 500, fontSize: 18, lineHeightPx: 27, letterSpacing: 0.15000000596 },
        styles: { text: 's3' },
        characterStyleOverrides: [0, 0, 1],
      }),
      node('INSTANCE', '1:3', 'Checkbox', {
        componentId: 'c1',
        componentProperties: {
          State: { type: 'VARIANT', value: 'Default' },
          Size: { type: 'VARIANT', value: 'md' },
          'Show label#12:3': { type: 'BOOLEAN', value: true },
        },
      }),
      node('INSTANCE', '1:4', 'Loose', { componentId: 'c2' }),
    ],
  });
  const { node: n } = normalizeFrame(
    entry(frame, {
      styles: {
        s1: { key: 'k1', name: 'White', styleType: 'FILL' },
        s2: { key: 'k2', name: 'gray/200', styleType: 'FILL' },
        s3: { key: 'k3', name: 'Display/headline/lg', styleType: 'TEXT' },
      },
      components: { c1: { key: 'ck1', name: 'State=Default, Size=md', componentSetId: 'set1', remote: true }, c2: { key: 'ck2', name: 'Divider' } },
      componentSets: { set1: { key: 'setkey', name: 'Checkbox', remote: true } },
    }),
  );
  assert.deepEqual(n.styles, { fill: 'White', stroke: 'gray/200' });
  assert.deepEqual(n.variables, { itemSpacing: ['VariableID:a/1'], fills: ['VariableID:b/2'], rectangleCornerRadii: ['VariableID:c/3'] });
  const [text, checkbox, loose] = n.children ?? [];
  assert.deepEqual(text?.text, { characters: 'Select data', family: 'Roboto', weight: 500, sizePx: 18, lineHeightPx: 27, letterSpacingPx: 0.15, mixed: true });
  assert.deepEqual(text?.styles, { text: 'Display/headline/lg' });
  assert.deepEqual(checkbox?.component, { name: 'Checkbox', key: 'setkey', remote: true, variant: { State: 'Default', Size: 'md' }, properties: { 'Show label': true } });
  assert.deepEqual(loose?.component, { name: 'Divider', key: 'ck2', remote: false, variant: {}, properties: {} });
});

test('toHex writes alpha only when not opaque', () => {
  assert.equal(toHex({ r: 0.082, g: 0.106, b: 0.149, a: 1 }, 1), '#151b26');
  assert.equal(toHex({ r: 1, g: 1, b: 1, a: 1 }, 0.5), '#ffffff80');
});
