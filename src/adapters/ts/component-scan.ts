import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { CodeComponent } from '../../mapping/components.ts';

const SKIP = /\.(test|spec|stories)\.tsx$/;

export class ComponentScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComponentScanError';
  }
}

/** Exported PascalCase functions, constants and classes in the `.tsx` files under each directory; a default export counts under its own name. */
export function scanComponents(root: string, dirs: readonly string[]): CodeComponent[] {
  const out: CodeComponent[] = [];
  for (const dir of dirs) {
    const abs = path.resolve(root, dir);
    if (!existsSync(abs)) throw new ComponentScanError(`${abs} does not exist (check components in the repo config)`);
    const files = (readdirSync(abs, { recursive: true }) as string[]).filter((f) => f.endsWith('.tsx') && !SKIP.test(f));
    for (const file of files.toSorted()) {
      const rel = path.relative(root, path.join(abs, file));
      for (const name of exportedComponents(path.join(abs, file))) out.push({ name, file: rel });
    }
  }
  return out;
}

function exportedComponents(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  const names = new Set<string>();
  for (const stmt of source.statements) {
    for (const name of exportedNames(stmt)) if (/^[A-Z]/.test(name)) names.add(name);
  }
  return [...names];
}

function exportedNames(stmt: ts.Statement): string[] {
  if (ts.isExportAssignment(stmt) && !stmt.isExportEquals && ts.isIdentifier(stmt.expression)) return [stmt.expression.text];
  if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause) && !stmt.moduleSpecifier) {
    return stmt.exportClause.elements.map((e) => e.name.text);
  }
  const exported = ts.canHaveModifiers(stmt) && ts.getModifiers(stmt)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  if (!exported) return [];
  if ((ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) && stmt.name) return [stmt.name.text];
  if (ts.isVariableStatement(stmt)) return stmt.declarationList.declarations.flatMap((d) => (ts.isIdentifier(d.name) ? [d.name.text] : []));
  return [];
}

/** Icon names in kebab case from a directory of icon modules such as lucide-react's `dist/esm/icons`. */
export function scanIconNames(dir: string): Set<string> {
  if (!existsSync(dir)) throw new ComponentScanError(`${dir} does not exist (check components.lucide in the repo config)`);
  return new Set(
    readdirSync(dir)
      .filter((f) => /\.(m?js)$/.test(f))
      .map((f) => f.replace(/\.m?js$/, '')),
  );
}
