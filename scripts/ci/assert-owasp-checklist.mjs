#!/usr/bin/env node
// Fail when the OWASP checklist claims something CI does not actually check.
//
// ## Why this is a gate and not a test
//
// `src/app/core/security/owasp.spec.ts` proves the registry is *well formed* — ten
// categories under the edition's titles, every verdict backed, every mitigation carrying
// at least one proof. It cannot prove the proofs are real, because a spec only sees the
// data: a `proofs` entry naming a spec that was renamed last month, deleted last week, or
// written into a suite nothing runs is a string, and a string type-checks.
//
// That is the whole failure mode of a security checklist. Ten categories with ten claims
// beside them is the most reassuring artifact a repository can hold, and every way it
// rots is silent:
//
//   1. **A proof that no longer exists.** Rename an `it(…)` while tidying a spec and the
//      claim it was carrying is now unproven. Nothing fails: the spec passes under its new
//      name, the registry still cites the old one, and the checklist still reads green.
//   2. **A proof in a suite CI does not run.** This repository has a Playwright project
//      that is deliberately not a CI gate — `chromium`, with its pre-existing failures.
//      A case parked there is a test somebody wrote, not a check that blocks a merge, and
//      citing one is how a checklist comes to describe intentions.
//   3. **A gate that stopped being invoked.** A `check:*` script dropped from the workflow
//      keeps working perfectly on a developer's machine and enforces nothing on a pull
//      request. Same for a rule deleted from inside a gate the workflow still runs, which
//      is what the `@owasp` markers below exist to catch.
//   4. **A document that drifted from the data.** `docs/owasp-top-10.md` is what an
//      auditor reads and what an API author implements the server half from. A category
//      whose verdict moved in the registry and not in the document leaves two internally
//      consistent artifacts disagreeing, and the prose is the one people trust.
//
// So every claim is resolved against the filesystem and against the workflow: a `spec`
// proof to a real `it(…)` in a file Karma compiles, an `e2e` proof to a real Playwright
// case in a project the workflow drives, a `gate` proof to a marked rule in a script an
// npm script in the workflow invokes. A claim cannot outlive the thing that made it true.
//
// Two claims have nowhere else to live and are checked here directly, because they are
// about the manifest rather than about any line of code: that no dependency runs an
// install script, and that CI installs the lockfile it was given. Both are cited from
// A03 and both carry `@owasp` markers like any other rule.
//
// This gate deliberately keeps **no copy of the Top 10**. The ten categories are an
// external fact; a gate with its own list would be a second place to drift and the one
// nobody would check. The transcription lives in `owasp.spec.ts`, where a reviewer sees
// it move.
//
// Usage:  node scripts/ci/assert-owasp-checklist.mjs
// See:    docs/owasp-top-10.md

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { repoRoot } from './lib/templates.mjs';

/** The registry, which this gate reads rather than restates. */
const REGISTRY = 'src/app/core/security/owasp.ts';

/** The prose half, which an auditor reads and an API author implements from. */
const DOC = 'docs/owasp-top-10.md';

/** The workflow that decides what is actually enforced on a pull request. */
const WORKFLOW = '.github/workflows/ci.yml';

/** Where CI's install happens, and so where `--frozen-lockfile` has to appear. */
const SETUP_ACTION = '.github/actions/setup/action.yml';

const LOCKFILE = 'pnpm-lock.yaml';

/** Scripts whose `@owasp` markers are read. */
const GATE_DIR = 'scripts/ci';

/**
 * Loads the registry by transpiling it and importing the result.
 *
 * The alternative — a gate with its own copy of the categories — is the thing this file
 * exists to prevent, one level up. `transpileModule` only erases types, so the data the
 * gate sees is the data the application ships, and the import fails loudly if the file
 * ever grows a runtime dependency (which its header forbids for exactly this reason).
 */
async function loadRegistry() {
  const source = readFileSync(join(repoRoot, REGISTRY), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: REGISTRY,
  });

  const encoded = Buffer.from(outputText, 'utf8').toString('base64');
  const module = await import(`data:text/javascript;base64,${encoded}`);

  if (!Array.isArray(module.OWASP_TOP_10) || typeof module.OWASP_EDITION !== 'string') {
    throw new Error(
      `assert-owasp-checklist: ${REGISTRY} no longer exports OWASP_TOP_10 and OWASP_EDITION. ` +
        'If the registry has been restructured, this gate needs restructuring with it.'
    );
  }

  return { edition: module.OWASP_EDITION, categories: module.OWASP_TOP_10 };
}

/**
 * Every string title passed to `it`/`test` in one file, read through the TypeScript
 * parser rather than matched.
 *
 * A regular expression gets this wrong on the titles this repository actually writes:
 * they contain apostrophes, both kinds of quote, and colons, and several are template
 * literals. The parser also distinguishes a literal title — which a proof can name — from
 * an interpolated one, which no proof can name exactly and which is therefore reported as
 * unciteable instead of silently missing.
 */
export function literalTestTitles(source, fileName, callees) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const titles = new Set();

  const visit = (node) => {
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
          ? callee.expression.text
          : null;

      if (name !== null && callees.has(name)) {
        const [first] = node.arguments;
        if (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) {
          titles.add(first.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return titles;
}

/** `src/**\/*.spec.ts` and friends, as a predicate. Only `**` and `*` are supported. */
export function globMatcher(pattern) {
  const expression = pattern
    .split('**/')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[^/]*'))
    .join('(?:.*/)?');
  const regex = new RegExp(`^${expression}$`);
  return (path) => regex.test(path);
}

/** The npm scripts the workflow runs, so a gate nobody invokes can be told apart. */
export function npmScriptsInWorkflow(workflow) {
  return new Set([...workflow.matchAll(/\bpnpm\s+(?:run\s+)?([a-z][a-z0-9:_-]*)/g)].map((m) => m[1]));
}

/**
 * `@owasp <mitigation id>` markers in a gate script, with the line they sit on.
 *
 * Read from the *comments*, not from the lines, and the comments are found by parsing the
 * file and collecting the comment ranges around its nodes. Two drafts got this wrong, and
 * both are worth recording because both failed quietly in the direction of reporting
 * fewer markers than exist — which in this gate means "no marker here", which reads as a
 * finding about the wrong file:
 *
 *   - **A line scan** reports marker text inside a string literal as a real marker. This
 *     file's own self-tests are full of such text, so the gate flagged its own fixtures.
 *   - **TypeScript's raw scanner** is context-free, so a regex literal like
 *     `/[.*+?^${}()|[\]\\]/g` is scanned as a slash followed by its contents as tokens —
 *     and the `'` inside the replacement that usually follows then opens a string that
 *     runs until the next apostrophe, swallowing every comment in between. Measured on
 *     `assert-csrf.mjs`: 62 comments found, the JSDoc marker among the ones eaten.
 *
 * A full parse handles regexes and strings correctly because that is its job.
 */
export function owaspMarkers(source, isJavaScript = true) {
  const pattern = /@owasp\s+([A-Z]\d{2}\.[a-z0-9-]+)/g;
  const lineAt = (offset) => source.slice(0, offset).split('\n').length;

  const inComments = (ranges) =>
    [...ranges].flatMap(([from, to]) =>
      [...source.slice(from, to).matchAll(pattern)].map((match) => ({
        id: match[1],
        line: lineAt(from + match.index),
      }))
    );

  if (!isJavaScript) {
    return source.split('\n').flatMap((line, index) => {
      const match = new RegExp(pattern.source).exec(line);
      return match ? [{ id: match[1], line: index + 1 }] : [];
    });
  }

  const sourceFile = ts.createSourceFile(
    'gate.mjs',
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.JS
  );

  const ranges = new Map();
  const collect = (found) => {
    for (const range of found ?? []) ranges.set(range.pos, range.end);
  };

  const visit = (node) => {
    collect(ts.getLeadingCommentRanges(source, node.getFullStart()));
    collect(ts.getTrailingCommentRanges(source, node.getEnd()));
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  collect(ts.getLeadingCommentRanges(source, sourceFile.endOfFileToken.getFullStart()));

  return inComments(ranges).sort((left, right) => left.line - right.line);
}

/**
 * The Playwright projects, and which directory each one owns.
 *
 * Parsed from the config rather than listed here, for the same reason the categories are
 * not listed here: a project renamed in one place and not the other is the drift. The
 * fields read are `name`, `testDir` and `testIgnore`, which is all that decides whether a
 * given file runs under a given project.
 *
 * Read through the TypeScript parser rather than matched. The first draft of this scanned
 * for `name:` and then looked ahead for a nearby `testDir:`, which is wrong in a way the
 * self-test below caught: "nearby" runs past the end of the object, so `chromium` — which
 * has no `testDir` of its own and inherits the top-level one — picked up the next
 * project's. That would have silently reported every file as covered by a project CI does
 * not run, which is the exact claim this gate exists to refuse.
 */
export function playwrightProjects(source) {
  const sourceFile = ts.createSourceFile(
    'playwright.config.ts',
    source,
    ts.ScriptTarget.Latest,
    true
  );

  const nameOf = (property) =>
    ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) ? property.name.text : null;
  const valueOf = (object, key) =>
    object.properties.find((property) => nameOf(property) === key)?.initializer ?? null;
  const stringOf = (node) =>
    node !== null && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      ? node.text
      : null;

  let config = null;
  const findConfig = (node) => {
    if (
      config === null &&
      ts.isObjectLiteralExpression(node) &&
      valueOf(node, 'projects') !== null
    ) {
      config = node;
    }
    ts.forEachChild(node, findConfig);
  };
  findConfig(sourceFile);

  if (config === null) {
    throw new Error(
      'assert-owasp-checklist: playwright.config.ts has no object literal with a `projects` ' +
        'property. If the config has been restructured, this gate needs restructuring with it.'
    );
  }

  const topLevelTestDir = stringOf(valueOf(config, 'testDir')) ?? './e2e';
  const projects = valueOf(config, 'projects');

  if (!ts.isArrayLiteralExpression(projects)) {
    throw new Error('assert-owasp-checklist: `projects` in playwright.config.ts is not an array.');
  }

  return projects.elements.filter(ts.isObjectLiteralExpression).flatMap((project) => {
    const name = stringOf(valueOf(project, 'name'));
    if (name === null) return [];

    const testDir = stringOf(valueOf(project, 'testDir')) ?? topLevelTestDir;
    const ignore = valueOf(project, 'testIgnore');
    const ignores = ts.isArrayLiteralExpression(ignore ?? ts.factory.createArrayLiteralExpression())
      ? (ignore?.elements ?? []).map(stringOf).filter((pattern) => pattern !== null)
      : [];

    return [{ name, testDir: testDir.replace(/^\.\//, ''), ignores }];
  });
}

/** Whether `file` would run under `project`. */
export function runsUnder(project, file) {
  if (!file.startsWith(`${project.testDir}/`)) return false;
  return !project.ignores.some((pattern) => globMatcher(pattern)(file));
}

/**
 * The two supply-chain claims, which are about the manifest and so have no spec to live
 * in.
 *
 * @owasp A03.no-dependency-runs-code-at-install
 * @owasp A03.the-lockfile-is-what-ci-installs
 */
export function auditManifest(manifest, setupAction, hasLockfile) {
  const failures = [];
  const built = manifest.pnpm?.onlyBuiltDependencies;

  if (!Array.isArray(built)) {
    failures.push({
      file: 'package.json',
      message:
        'pnpm.onlyBuiltDependencies is not declared. pnpm then falls back to running the ' +
        'install scripts of whatever asks, which is the one step where a compromised ' +
        'dependency executes with full privileges before any of its code is imported — on ' +
        'every developer machine and every runner. Declare it, empty',
    });
  } else if (built.length > 0) {
    failures.push({
      file: 'package.json',
      message:
        `pnpm.onlyBuiltDependencies allows install scripts for ${built.join(', ')}. ` +
        'A03 in docs/owasp-top-10.md claims no dependency runs code at install time. ' +
        'If one genuinely must, say which and why in that document and amend the claim ' +
        'rather than leaving the checklist overstating it',
    });
  }

  if (!hasLockfile) {
    failures.push({
      file: LOCKFILE,
      message:
        'there is no committed lockfile, so --frozen-lockfile has nothing to freeze and ' +
        'every install may resolve a different dependency graph than the one reviewed',
    });
  }

  if (!setupAction.includes('--frozen-lockfile')) {
    failures.push({
      file: SETUP_ACTION,
      message:
        'CI no longer installs with --frozen-lockfile. The lockfile is then advisory: a ' +
        'run can resolve a newer version of any transitive dependency, so what CI tested ' +
        'is not what the lockfile describes, and nothing in the logs says so',
    });
  }

  return failures;
}

/**
 * Compares the document against the registry.
 *
 * The document is the artifact people actually read, so the rules are about the parts a
 * reader relies on: the summary table, the per-category sections, the server contracts an
 * API author implements from, and that every claim in the data is written down somewhere
 * a human can read it.
 */
export function auditDocument(doc, categories) {
  const failures = [];
  const rows = doc.split('\n').filter((line) => line.trimStart().startsWith('|'));

  for (const category of categories) {
    const matching = rows.filter((row) => row.includes(`${category.id}:2025`));

    if (matching.length !== 1) {
      failures.push({
        file: DOC,
        message:
          `the summary table has ${matching.length} row(s) naming ${category.id}:2025, not ` +
          `exactly one. The table is what a reader skims instead of reading the sections`,
      });
      continue;
    }

    const [row] = matching;
    if (!row.includes(category.title)) {
      failures.push({
        file: DOC,
        message:
          `the ${category.id} row does not carry the title the registry gives it ` +
          `(“${category.title}”). A renamed category in one of the two places is the ` +
          `drift this rule exists for`,
      });
    }

    if (!row.includes(`\`${category.verdict}\``)) {
      failures.push({
        file: DOC,
        message:
          `the ${category.id} row does not carry the verdict \`${category.verdict}\`. A ` +
          `verdict that moved in the registry and not here leaves the prose — the half ` +
          `people trust — claiming more or less than the data`,
      });
    }

    const heading = new RegExp(`^#{2,3} .*${category.id}:2025`, 'm');
    if (!heading.test(doc)) {
      failures.push({
        file: DOC,
        message: `there is no section heading for ${category.id}:2025`,
      });
    }

    for (const mitigation of category.mitigations) {
      if (!doc.includes(mitigation.id)) {
        failures.push({
          file: DOC,
          message:
            `the claim \`${mitigation.id}\` is in the registry and nowhere in this ` +
            `document. A claim CI enforces and the document omits is a defence the next ` +
            `reader will not know they have`,
        });
      }
    }

    if (category.serverContract !== undefined) {
      const section = sectionFor(doc, category.serverContract);
      if (section === null) {
        failures.push({
          file: DOC,
          message:
            `there is no heading “${category.serverContract}”, which ${category.id} names ` +
            `as where its server contract lives`,
        });
      } else if (!/what the server must do/i.test(section)) {
        failures.push({
          file: DOC,
          message:
            `the “${category.serverContract}” section says nothing about what the server ` +
            `must do. ${category.id} is recorded as \`${category.verdict}\`, which means ` +
            `the risk was handed somewhere — and a hand-off with no instructions is the ` +
            `risk recorded and dropped`,
        });
      }
    }
  }

  return failures;
}

/** The text under a heading, up to the next heading of the same or higher level. */
function sectionFor(doc, headingText) {
  const lines = doc.split('\n');
  const start = lines.findIndex(
    (line) => /^#{2,3} /.test(line) && line.includes(headingText)
  );
  if (start === -1) return null;

  const level = /^(#+)/.exec(lines[start])[1].length;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => {
    const match = /^(#+) /.exec(line);
    return match !== null && match[1].length <= level;
  });

  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

/** Every `.ts` under a root, repo-relative and forward-slashed. */
async function filesUnder(root) {
  const walk = async (dir) => {
    const entries = await readdir(dir, { withFileTypes: true });
    const found = await Promise.all(
      entries.map(async (entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return walk(path);
        return entry.isFile() ? [path] : [];
      })
    );
    return found.flat();
  };

  if (!existsSync(join(repoRoot, root))) return [];
  const absolute = await walk(join(repoRoot, root));
  return absolute.map((path) => relative(repoRoot, path).split('\\').join('/'));
}

async function main() {
  for (const selfTest of SELF_TESTS) selfTest();

  const { edition, categories } = await loadRegistry();
  const failures = [];

  const workflow = readFileSync(join(repoRoot, WORKFLOW), 'utf8');
  const invoked = npmScriptsInWorkflow(workflow);
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const playwright = playwrightProjects(
    readFileSync(join(repoRoot, 'playwright.config.ts'), 'utf8')
  );
  const specIncludes = JSON.parse(
    readFileSync(join(repoRoot, 'tsconfig.spec.json'), 'utf8')
  ).include.map(globMatcher);

  // The Playwright projects CI actually drives, derived from the workflow rather than
  // assumed: `chromium` is deliberately not one of them, and a case parked there is a
  // test somebody wrote, not a check that blocks a merge.
  const ciProjects = playwright.filter((project) =>
    [...invoked].some((script) => {
      const command = manifest.scripts?.[script];
      return typeof command === 'string' && command.includes(`--project=${project.name}`);
    })
  );

  const titleCache = new Map();
  const titlesOf = (file, callees) => {
    const key = `${file}:${[...callees].join(',')}`;
    if (!titleCache.has(key)) {
      const source = readFileSync(join(repoRoot, file), 'utf8');
      titleCache.set(key, literalTestTitles(source, file, callees));
    }
    return titleCache.get(key);
  };

  let proofCount = 0;
  const citedMarkers = new Map();

  for (const category of categories) {
    for (const mitigation of category.mitigations) {
      for (const proof of mitigation.proofs) {
        proofCount += 1;
        const blame = `${mitigation.id} cites`;

        if (proof.kind === 'gate') {
          const script = proof.script;
          if (!existsSync(join(repoRoot, script))) {
            failures.push({ file: REGISTRY, message: `${blame} ${script}, which does not exist` });
            continue;
          }

          const command = manifest.scripts?.[proof.command];
          if (typeof command !== 'string') {
            failures.push({
              file: 'package.json',
              message: `${blame} the npm script \`${proof.command}\`, which is not declared`,
            });
            continue;
          }

          if (!command.includes(script)) {
            failures.push({
              file: 'package.json',
              message:
                `${blame} \`${proof.command}\` as the way ${script} runs, but that script ` +
                `runs \`${command}\` instead`,
            });
          }

          if (!invoked.has(proof.command)) {
            failures.push({
              file: WORKFLOW,
              message:
                `${blame} \`pnpm ${proof.command}\`, which ${WORKFLOW} never runs. The gate ` +
                `still works on a developer’s machine and enforces nothing on a pull ` +
                `request, which is the difference between a check and a habit`,
            });
          }

          const markers = owaspMarkers(
            readFileSync(join(repoRoot, script), 'utf8'),
            script.endsWith('.mjs')
          );
          if (!markers.some((marker) => marker.id === mitigation.id)) {
            failures.push({
              file: script,
              message:
                `${blame} this gate, but nothing in it is marked \`@owasp ${mitigation.id}\`. ` +
                `The marker is what ties the claim to the rule that enforces it: without ` +
                `one, deleting the rule leaves the gate green and the claim standing`,
            });
          }
          citedMarkers.set(`${script}:${mitigation.id}`, true);
          continue;
        }

        const file = proof.file;
        if (!existsSync(join(repoRoot, file))) {
          failures.push({ file: REGISTRY, message: `${blame} ${file}, which does not exist` });
          continue;
        }

        if (proof.kind === 'spec') {
          if (!specIncludes.some((matches) => matches(file))) {
            failures.push({
              file: REGISTRY,
              message:
                `${blame} ${file}, which tsconfig.spec.json does not include, so Karma never ` +
                `compiles it and \`pnpm test\` never runs it`,
            });
          }

          if (!titlesOf(file, new Set(['it', 'fit'])).has(proof.test)) {
            failures.push({
              file,
              message:
                `${blame} the spec “${proof.test}”, which is not in this file. A renamed or ` +
                `deleted spec leaves the claim unproven with every suite still green`,
            });
          }
          continue;
        }

        if (!titlesOf(file, new Set(['test'])).has(proof.test)) {
          failures.push({
            file,
            message: `${blame} the e2e case “${proof.test}”, which is not in this file`,
          });
          continue;
        }

        const covering = ciProjects.filter((project) => runsUnder(project, file));
        if (covering.length === 0) {
          failures.push({
            file: REGISTRY,
            message:
              `${blame} ${file}, which no Playwright project that ${WORKFLOW} runs covers. ` +
              `The case exists and nothing makes it run before a merge`,
          });
        }
      }
    }
  }

  // The other direction. A marker is a promise that a rule enforces a named claim, so an
  // orphaned one means the claim was renamed or removed and the rule left behind — which
  // reads, to the next person in the file, as a claim that is still being made.
  const gateFiles = (await filesUnder(GATE_DIR)).filter(
    (file) => file.endsWith('.mjs') || file.endsWith('.sh')
  );
  const known = new Map(
    categories.flatMap((category) =>
      category.mitigations.map((mitigation) => [mitigation.id, mitigation])
    )
  );

  for (const file of gateFiles) {
    for (const marker of owaspMarkers(
      readFileSync(join(repoRoot, file), 'utf8'),
      file.endsWith('.mjs')
    )) {
      const mitigation = known.get(marker.id);
      if (mitigation === undefined) {
        failures.push({
          file,
          line: marker.line,
          message:
            `marked \`@owasp ${marker.id}\`, which is not a claim in ${REGISTRY}. Either the ` +
            `claim was renamed and this rule was left pointing at the old name, or it was ` +
            `removed and this rule is now enforcing something nothing claims`,
        });
        continue;
      }

      if (!citedMarkers.has(`${file}:${marker.id}`)) {
        failures.push({
          file,
          line: marker.line,
          message:
            `marked \`@owasp ${marker.id}\`, but that claim does not cite this gate as one ` +
            `of its proofs. The link has to hold in both directions or the checklist and ` +
            `the gates are two sets of assertions that merely look related`,
        });
      }
    }
  }

  failures.push(
    ...auditManifest(
      manifest,
      readFileSync(join(repoRoot, SETUP_ACTION), 'utf8'),
      existsSync(join(repoRoot, LOCKFILE))
    )
  );

  failures.push(...auditDocument(readFileSync(join(repoRoot, DOC), 'utf8'), categories));

  const mitigationCount = categories.reduce(
    (total, category) => total + category.mitigations.length,
    0
  );

  writeSummary(
    `### ${edition}\n\n` +
      `${categories.length} categories, ${mitigationCount} claims, ${proofCount} proof(s) ` +
      `resolved against the suites and gates \`${WORKFLOW}\` runs; ${failures.length} ` +
      `problem(s) found.\n`
  );

  if (failures.length > 0) {
    for (const failure of failures) {
      const location = failure.line
        ? `file=${failure.file},line=${failure.line}`
        : `file=${failure.file}`;
      console.error(`::error ${location}::OWASP checklist — ${failure.message}`);
    }
    console.error(`See ${DOC} for the checklist these rules hold the repository to.`);
    process.exit(1);
  }

  console.log(
    `assert-owasp-checklist: clean (${edition}; ${mitigationCount} claims, ${proofCount} ` +
      `proofs, ${SELF_TESTS.length} rule self-tests passed)`
  );
}

/**
 * The rules, proven against the failures they name before the repository is certified.
 *
 * Same reasoning as the other gates here: a rule that cannot be shown to fail is a rule
 * that might be matching nothing, and this file's whole value is that it catches drift no
 * test would.
 */
const SELF_TESTS = [
  () => {
    const titles = literalTestTitles(
      `it('a plain title', () => {});\nit(\`a template title\`, () => {});\n` +
        `it(\`interpolated \${x}\`, () => {});\ndescribe('not an it', () => {});`,
      'probe.spec.ts',
      new Set(['it'])
    );
    if (!titles.has('a plain title')) throw new Error('a quoted it() title is not read');
    if (!titles.has('a template title')) throw new Error('a template it() title is not read');
    if (titles.has('not an it')) throw new Error('a describe() title is read as an it()');
    if (titles.size !== 2) throw new Error('an interpolated title is reported as citeable');
  },
  () => {
    // The titles this repository actually writes: apostrophes, both kinds, and colons.
    const titles = literalTestTitles(
      `it('is why sanitize() alone is not a guarantee: it unwraps a bypassed value', () => {});` +
        `\nit('refuses Angular’s bypass policy', () => {});`,
      'probe.spec.ts',
      new Set(['it'])
    );
    if (!titles.has('is why sanitize() alone is not a guarantee: it unwraps a bypassed value')) {
      throw new Error('a title containing parentheses and a colon is not read');
    }
    if (!titles.has('refuses Angular’s bypass policy')) {
      throw new Error('a title containing an apostrophe is not read');
    }
  },
  () => {
    const matches = globMatcher('src/**/*.spec.ts');
    if (!matches('src/app/core/security/owasp.spec.ts')) throw new Error('a nested spec is missed');
    if (!matches('src/a.spec.ts')) throw new Error('a top-level spec is missed');
    if (matches('e2e/csrf/csrf.spec.ts')) throw new Error('the glob reaches outside src/');
    if (matches('src/app/app.config.ts')) throw new Error('a non-spec file matches');
  },
  () => {
    const matches = globMatcher('**/a11y/**');
    if (!matches('e2e/a11y/axe.spec.ts')) throw new Error('a testIgnore pattern misses its dir');
    if (matches('e2e/csrf/csrf.spec.ts')) throw new Error('a testIgnore pattern is too broad');
  },
  () => {
    const scripts = npmScriptsInWorkflow('      - run: pnpm check:csp\n      - run: |\n  pnpm run lint');
    if (!scripts.has('check:csp')) throw new Error('a `pnpm <script>` invocation is missed');
    if (!scripts.has('lint')) throw new Error('a `pnpm run <script>` invocation is missed');
    if (scripts.has('exec')) throw new Error('unexpected script read');
  },
  () => {
    // Line 1 is a real marker; line 3 is malformed and must not be read; line 4 is marker
    // text inside a string, which is what this file's own self-tests are full of.
    const probe = [
      '// @owasp A01.guards-fail-closed',
      'const x = 1;',
      '// @owasp not-an-id',
      "const y = '@owasp A05.sanitiser-is-never-bypassed';",
    ].join('\n');
    const markers = owaspMarkers(probe);

    if (markers.length !== 1) {
      throw new Error(`marker scanning read ${markers.length} markers, not 1`);
    }
    if (markers[0].id !== 'A01.guards-fail-closed' || markers[0].line !== 1) {
      throw new Error('a marker is read at the wrong line or with the wrong id');
    }
    if (owaspMarkers('/* @owasp A02.csp-is-enforced-and-per-response */').length !== 1) {
      throw new Error('a marker in a block comment is missed');
    }
  },
  () => {
    const projects = playwrightProjects(
      [
        'export default defineConfig({',
        "  testDir: './e2e',",
        '  projects: [',
        // `chromium` first and with no `testDir`, which is the case the regex draft got
        // wrong: it inherits the top-level directory and must not pick up `a11y`'s.
        "    { name: 'chromium', testIgnore: ['**/a11y/**'], use: { ...devices['Desktop Chrome'] } },",
        "    { name: 'a11y', testDir: './e2e/a11y' },",
        '  ],',
        '});',
      ].join('\n')
    );
    const chromium = projects.find((project) => project.name === 'chromium');
    const a11y = projects.find((project) => project.name === 'a11y');
    if (chromium?.testDir !== 'e2e') throw new Error('a project does not inherit the top testDir');
    if (a11y?.testDir !== 'e2e/a11y') throw new Error('an explicit testDir is not read');
    if (!runsUnder(a11y, 'e2e/a11y/axe.spec.ts')) throw new Error('a covered file is not covered');
    if (runsUnder(chromium, 'e2e/a11y/axe.spec.ts')) throw new Error('testIgnore is not applied');
    if (!runsUnder(chromium, 'e2e/login.spec.ts')) throw new Error('testIgnore is too broad');
  },
  () => {
    const bad = auditManifest({ pnpm: { onlyBuiltDependencies: ['esbuild'] } }, '', true);
    if (bad.length !== 2) throw new Error('an install-script allowance is not flagged');
    const missing = auditManifest({}, '--frozen-lockfile', true);
    if (missing.length !== 1) throw new Error('an undeclared onlyBuiltDependencies is not flagged');
    const noLock = auditManifest({ pnpm: { onlyBuiltDependencies: [] } }, '--frozen-lockfile', false);
    if (noLock.length !== 1) throw new Error('a missing lockfile is not flagged');
    const good = auditManifest(
      { pnpm: { onlyBuiltDependencies: [] } },
      'pnpm install --frozen-lockfile',
      true
    );
    if (good.length !== 0) throw new Error('a compliant manifest is flagged');
  },
  () => {
    const category = {
      id: 'A01',
      title: 'Broken Access Control',
      verdict: 'shared-with-server',
      serverContract: 'A01:2025 — Broken Access Control',
      mitigations: [{ id: 'A01.one', claim: 'x', proofs: [] }],
    };
    const good = [
      '| [A01:2025 — Broken Access Control](#a) | `shared-with-server` | owned |',
      '',
      '## A01:2025 — Broken Access Control',
      '',
      'A01.one holds.',
      '',
      '### What the server must do',
      '',
      '- authorise every request',
    ].join('\n');
    if (auditDocument(good, [category]).length !== 0) {
      throw new Error('a correct document is flagged');
    }
    if (auditDocument(good.replace('`shared-with-server`', '`client-mitigated`'), [category]).length !== 1) {
      throw new Error('a drifted verdict is not flagged');
    }
    if (auditDocument(good.replace('A01.one holds.', ''), [category]).length !== 1) {
      throw new Error('an undocumented claim is not flagged');
    }
    if (auditDocument(good.replace('### What the server must do', '### Notes'), [category]).length !== 1) {
      throw new Error('a server contract with no instructions is not flagged');
    }
    if (auditDocument(good.replace('Broken Access Control', 'Something Else'), [category]).length < 1) {
      throw new Error('a retitled category is not flagged');
    }
  },
];

/** Append to the GitHub Actions job summary when there is one, so the audit lands on the PR. */
function writeSummary(markdown) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  appendFileSync(path, `${markdown}\n`);
}

await main();
