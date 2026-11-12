import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { CvaReadError, readCva } from '../src/adapters/ts/cva-reader.ts';

const file = path.join(import.meta.dirname, '../fixtures/tailwind-v4/src/ui/heading.tsx');

test('readCva reads array bases, numeric keys, boolean keys and defaults', () => {
  assert.deepEqual(readCva(file, 'headingVariants'), {
    base: 'font-display font-bold',
    variants: {
      level: { '1': 'text-h1 leading-tight', '2': 'text-body tracking-wider' },
      tone: { muted: 'text-gray-200' },
    },
    defaults: { level: '1' },
  });
  assert.deepEqual(readCva(file, 'bodyVariants').variants['strong'], { true: 'font-normal' });
});

test('readCva says where it cannot read', () => {
  assert.throws(
    () => readCva(file, 'missingVariants'),
    (err) => err instanceof CvaReadError && /no `const missingVariants = cva/.test(err.message),
  );
  assert.throws(
    () => readCva(file, 'brokenVariants'),
    (err) => err instanceof CvaReadError && /heading\.tsx:\d+: class value is not a literal/.test(err.message),
  );
});
