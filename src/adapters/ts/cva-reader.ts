import { readFileSync } from 'node:fs';
import ts from 'typescript';
import type { VariantDefinition } from '../../catalogue/variants.ts';

export class CvaReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CvaReadError';
  }
}

/** Reads the `cva(...)` call assigned to `variable` in a TypeScript or TSX file. Only literal arguments are understood. */
export function readCva(file: string, variable: string): VariantDefinition {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found: ts.CallExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === variable && node.initializer) {
      const init = node.initializer;
      if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === 'cva') found = init;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!found) throw new CvaReadError(`${file}: no \`const ${variable} = cva(...)\``);

  const [baseArg, configArg] = found.arguments;
  const config = configArg && ts.isObjectLiteralExpression(configArg) ? configArg : undefined;
  return {
    base: baseArg ? classString(baseArg, file) : '',
    variants: config ? readVariants(config, file) : {},
    defaults: config ? readDefaults(config) : {},
  };
}

function readVariants(config: ts.ObjectLiteralExpression, file: string): Record<string, Record<string, string>> {
  const node = property(config, 'variants');
  if (!node || !ts.isObjectLiteralExpression(node)) return {};
  const variants: Record<string, Record<string, string>> = {};
  for (const prop of objectEntries(node)) {
    if (ts.isObjectLiteralExpression(prop.value)) {
      variants[prop.key] = Object.fromEntries(objectEntries(prop.value).map((v) => [v.key, classString(v.value, file)]));
    }
  }
  return variants;
}

function readDefaults(config: ts.ObjectLiteralExpression): Record<string, string> {
  const node = property(config, 'defaultVariants');
  if (!node || !ts.isObjectLiteralExpression(node)) return {};
  const defaults: Record<string, string> = {};
  for (const d of objectEntries(node)) {
    const literal = literalText(d.value);
    if (literal !== undefined) defaults[d.key] = literal;
  }
  return defaults;
}

function property(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  return objectEntries(obj).find((e) => e.key === name)?.value;
}

function objectEntries(obj: ts.ObjectLiteralExpression): { key: string; value: ts.Expression }[] {
  const out: { key: string; value: ts.Expression }[] = [];
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p)) continue;
    const name = p.name;
    const key = ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : undefined;
    if (key !== undefined) out.push({ key, value: p.initializer });
  }
  return out;
}

function literalText(node: ts.Expression): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return 'true';
  if (node.kind === ts.SyntaxKind.FalseKeyword) return 'false';
  return undefined;
}

/** A class string, or an array of them as cva also accepts. */
function classString(node: ts.Expression, file: string): string {
  const literal = literalText(node);
  if (literal !== undefined) return literal;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map((e) => classString(e as ts.Expression, file)).join(' ');
  const { line } = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart());
  throw new CvaReadError(`${file}:${line + 1}: class value is not a literal`);
}
