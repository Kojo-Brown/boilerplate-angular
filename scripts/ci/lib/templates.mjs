// Shared reader for the component templates in `src/app/`.
//
// Two gates need the same thing — every `@for` block, and every `<img>` element, with a
// `file:line` a reviewer can click — and neither can get it from the source text.
// `assert-for-track.mjs` asks whether a `@for`'s track expression identifies the row;
// `assert-image-hygiene.mjs` asks whether an `<img>` goes through `NgOptimizedImage`.
// A regular expression answers neither: `track` is followed by an arbitrary Angular
// expression, `<img>` carries a mix of static attributes and bound inputs, and both live
// inside a TypeScript template literal whose escapes a text scan gets wrong.
//
// So this reads templates the way the compiler does, in two passes:
//
//   1. TypeScript parses the `.ts` file and hands back the `template:` property's literal
//      — its cooked text, and the line the backtick sits on. That is what makes a
//      reported line a line in the file the reviewer opens, rather than a line in a
//      string. Escapes (`\``, which several templates use inside HTML comments) are
//      already resolved, and since an escape never spans a newline the line numbering of
//      the cooked text still matches the file's.
//   2. `@angular/compiler`'s own `parseTemplate` turns that text into the template AST.
//      Using the compiler rather than a hand-written parser is the point: `@for`,
//      `@defer`, `@if` and bound attributes are its grammar, and a second implementation
//      of it would drift from the one that actually builds the application.
//
// Only inline templates are read, because that is all this repository has: every
// component in `src/app/` declares `template:`, and `templateUrl:` would need the same
// two passes with the file resolved first. `collectTemplates` throws on a `templateUrl`
// rather than skipping it, so adding one fails the gates loudly instead of silently
// removing a component from their coverage.

import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTemplate } from '@angular/compiler';
import ts from 'typescript';

/** Absolute path to the repository root, independent of the caller's cwd. */
export const repoRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

/** The tree whose templates ship. Specs are excluded; see {@link collectTemplates}. */
const SOURCE_ROOT = 'src/app';

/**
 * @typedef {object} InlineTemplate
 * @property {string} file       Repository-relative path of the `.ts` file.
 * @property {string} text       The template's cooked text.
 * @property {number} startLine  1-based file line the template literal opens on, which is
 *                               also the file line of the text's first line.
 * @property {import('@angular/compiler').TmplAstNode[]} nodes  Parsed template AST.
 * @property {string[]} imports  Identifiers listed in the decorator's `imports` array.
 */

/**
 * Every inline component template under `src/app/`, parsed.
 *
 * Spec files are excluded. Their templates belong to test hosts that never ship, and a
 * spec that deliberately renders a bad `<img>` or a hostile track expression — which is
 * how the gates below are themselves tested — must not fail the gate it is testing.
 *
 * @returns {Promise<InlineTemplate[]>}
 */
export async function collectTemplates() {
  const files = await listTypeScriptFiles(join(repoRoot, SOURCE_ROOT));
  const templates = [];

  for (const absolute of files.sort()) {
    const file = relative(repoRoot, absolute);
    if (file.endsWith('.spec.ts')) continue;
    templates.push(...parseFile(file, readFileSync(absolute, 'utf8')));
  }

  if (templates.length === 0) {
    throw new Error(
      `No inline component templates found under ${SOURCE_ROOT}/ — has the layout changed?`
    );
  }

  return templates;
}

/**
 * Parse one file's inline templates.
 *
 * Exported so the gates' own specs can drive it with a source string instead of a fixture
 * on disk: every rule below is asserted against a template written to provoke it, and
 * writing those to files would mean a directory of deliberately broken components that
 * the compiler, the linter and the other gate would all then have to be told to skip.
 *
 * @param {string} file Repository-relative path, used only in messages.
 * @param {string} source The file's TypeScript source.
 * @returns {InlineTemplate[]}
 */
export function parseFile(file, source) {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found = [];

  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && propertyName(node) === 'templateUrl') {
      const { line } = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart(sourceFile));
      throw new Error(
        `${file}:${line + 1}: templateUrl is not supported by the template gates, which read ` +
          `inline templates only. Either inline the template or teach scripts/ci/lib/templates.mjs ` +
          `to resolve the file.`
      );
    }

    if (ts.isPropertyAssignment(node) && propertyName(node) === 'template') {
      const literal = node.initializer;
      // A `template` built by concatenation or read from a constant has no single literal
      // to attribute lines to. Nothing here does that, and the throw keeps it that way.
      if (!ts.isNoSubstitutionTemplateLiteral(literal) && !ts.isStringLiteral(literal)) {
        const { line } = ts.getLineAndCharacterOfPosition(sourceFile, literal.getStart(sourceFile));
        throw new Error(
          `${file}:${line + 1}: template must be a plain template literal so the gates can map ` +
            `template lines back to file lines.`
        );
      }

      const { line } = ts.getLineAndCharacterOfPosition(sourceFile, literal.getStart(sourceFile));
      const text = literal.text;
      const parsed = parseTemplate(text, file, { preserveWhitespaces: true });

      if (parsed.errors?.length) {
        const first = parsed.errors[0];
        throw new Error(`${file}: template failed to parse — ${first.msg}`);
      }

      found.push({
        file,
        text,
        startLine: line + 1,
        nodes: parsed.nodes,
        imports: declaredImports(node.parent),
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
}

/**
 * The file line a template AST node starts on.
 *
 * `ParseSourceSpan` lines are 0-based and relative to the template text; the literal's own
 * line is where line 0 of that text sits, so the two add.
 *
 * @param {InlineTemplate} template
 * @param {{ start: { line: number } }} span
 * @returns {number}
 */
export function fileLineOf(template, span) {
  return template.startLine + span.start.line;
}

/**
 * Walk a template AST depth-first, calling `visit` with each node and its ancestors.
 *
 * The ancestor chain is what lets a rule ask a structural question — "is this `<img>`
 * inside a `@for`?", "inside a `@defer`?" — which is the difference between a gate that
 * checks attributes and one that checks meaning.
 *
 * @param {import('@angular/compiler').TmplAstNode[]} nodes
 * @param {(node: any, ancestors: readonly any[]) => void} visit
 * @param {readonly any[]} [ancestors]
 */
export function walk(nodes, visit, ancestors = []) {
  for (const node of nodes ?? []) {
    visit(node, ancestors);

    const chain = [...ancestors, node];

    walk(node.children, visit, chain);

    // Blocks keep their alternative views in named properties rather than in `children`,
    // so a plain `children` recursion would walk the happy path and silently skip every
    // placeholder, loading state, error state, empty state and `@else` branch — which is
    // exactly where an unreviewed `<img>` or `@for` tends to be parked.
    for (const branch of ['placeholder', 'loading', 'error', 'empty']) {
      if (node[branch]) walk(node[branch].children, visit, chain);
    }
    if (node.branches) {
      for (const branch of node.branches) walk(branch.children, visit, chain);
    }
    if (node.cases) {
      for (const branch of node.cases) walk(branch.children, visit, chain);
    }
  }
}

/**
 * The identifiers in the decorator metadata's `imports` array.
 *
 * Needed because a directive that is not imported does not apply, and for an attribute
 * like `ngSrc` that failure is silent: with `NgOptimizedImage` missing from `imports`
 * nothing matches the attribute, so it is emitted as a literal `ngsrc` on the element, no
 * `src` is ever set, and neither the compiler nor the linter says a word. Only names are
 * collected — a spread or a shared constant yields nothing, which a rule must treat as
 * "cannot tell" rather than as "absent".
 *
 * @param {ts.ObjectLiteralExpression} metadata The object literal holding `template`.
 * @returns {string[]}
 */
function declaredImports(metadata) {
  if (!metadata || !ts.isObjectLiteralExpression(metadata)) return [];

  const property = metadata.properties.find(
    (candidate) => ts.isPropertyAssignment(candidate) && propertyName(candidate) === 'imports'
  );
  if (!property || !ts.isArrayLiteralExpression(property.initializer)) return [];

  return property.initializer.elements.filter(ts.isIdentifier).map((element) => element.text);
}

/** `PropertyAssignment` name as written, for identifier and string-literal keys alike. */
function propertyName(node) {
  if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) return node.name.text;
  return null;
}

/** Every `.ts` file under `dir`, recursively. */
async function listTypeScriptFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return listTypeScriptFiles(path);
      return entry.isFile() && path.endsWith('.ts') ? [path] : [];
    })
  );
  return files.flat();
}
