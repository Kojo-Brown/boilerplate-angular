#!/usr/bin/env node
// Fail when a `@defer` block has stopped deferring anything.
//
// `@defer` is the one Angular feature whose failure mode is completely silent. The
// compiler emits a dynamic import for a component whose only uses in a template are
// inside `@defer` blocks, and an ordinary static import otherwise — and "otherwise" is
// reached by edits that look harmless: naming the component in the `@placeholder` or
// `@error` block beside it, rendering it once outside the block, or importing a *value*
// from its file (a constant, a type used at runtime, a helper) somewhere eager. The page
// still works, every spec still passes, the bundle budget moves by a couple of kilobytes,
// and the block quietly renders content the browser already had.
//
// Nothing else in the pipeline notices. A lint rule cannot: whether a symbol is deferred
// is a property of the whole compiled template plus the module graph around it, not of
// any one file's syntax. The build's own output is the only place the answer exists, so
// this reads it.
//
// ## What it checks
//
// For each pair in DEFERRED_BLOCKS below, against the esbuild metafile the Angular
// builder writes as `stats.json`:
//
//   1. The component's source lands in a *different* output chunk from its host's.
//   2. The host's chunk does not reach the component's through any chain of static
//      imports — which is what "deferred" actually means, and is not the same as "the
//      chunk is lazy": the dashboard is itself behind a lazy route, so a de-optimised
//      block would still be in a chunk nothing loads eagerly.
//   3. The host's chunk *does* dynamically import the component's chunk, so a block that
//      was deleted, or a component that became unreachable, fails here rather than
//      passing as trivially-deferred.
//
// ## Why a second build
//
// `pnpm build` deliberately does not pass `--stats-json`: the metafile maps every output
// chunk back to the source paths that went into it, which is the one thing minification
// takes away, and it would ship inside `dist/` next to the bundles. So this runs its own
// production build into a scratch directory and reads the metafile from there. That costs
// one extra build in CI, which is the price of the deploy artifact staying clean.
//
// Point STATS_JSON at an existing metafile to skip the build while iterating locally:
//
//   pnpm exec ng build --stats-json && \
//     STATS_JSON=dist/boilerplate-angular/stats.json node scripts/ci/assert-deferred-chunks.mjs
//
// Usage: node scripts/ci/assert-deferred-chunks.mjs

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));

/**
 * Every `@defer`red component in the application, and the component whose template
 * defers it.
 *
 * Maintained by hand, and that is the point: adding a `@defer` block is a decision, and
 * an entry here is how the decision gets a test. The paths are checked against the
 * metafile's own input list, so a rename that misses this file fails the gate instead of
 * silently checking nothing.
 */
const DEFERRED_BLOCKS = [
  {
    component: 'src/app/features/dashboard/insights/insights-panel.component.ts',
    host: 'src/app/features/dashboard/dashboard.component.ts',
    trigger: 'on viewport; prefetch on idle',
  },
  {
    component: 'src/app/features/dashboard/insights/insights-breakdown.component.ts',
    host: 'src/app/features/dashboard/dashboard.component.ts',
    trigger: 'on interaction(ref); prefetch on hover(ref)',
  },
  {
    component: 'src/app/features/dashboard/release-notes/release-notes.component.ts',
    host: 'src/app/features/dashboard/dashboard.component.ts',
    trigger: 'on timer(4s); prefetch on idle',
  },
];

/** Read the metafile named by `STATS_JSON`, or produce one from a scratch build. */
function loadStats() {
  const existing = process.env.STATS_JSON;
  if (existing) {
    return JSON.parse(readFileSync(resolve(repoRoot, existing), 'utf8'));
  }

  const outDir = mkdtempSync(join(tmpdir(), 'defer-stats-'));
  try {
    execFileSync(
      'node',
      [
        join(repoRoot, 'node_modules', '@angular', 'cli', 'bin', 'ng.js'),
        'build',
        '--configuration',
        'production',
        '--stats-json',
        '--output-path',
        outDir,
      ],
      { cwd: repoRoot, stdio: ['ignore', 'ignore', 'inherit'] }
    );
    return JSON.parse(readFileSync(join(outDir, 'stats.json'), 'utf8'));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

/** The output chunk a source file was bundled into, or `null` if it was not bundled. */
function chunkContaining(outputs, sourcePath) {
  for (const [name, output] of Object.entries(outputs)) {
    if (Object.hasOwn(output.inputs, sourcePath)) return name;
  }
  return null;
}

/**
 * Every chunk reachable from `start` by following static imports, `start` included.
 *
 * Transitive on purpose: an eager reference does not have to be direct. A component
 * pulled in through a barrel file, or through a second component the host imports
 * eagerly, is one static hop further away and just as un-deferred.
 */
function staticClosure(outputs, start) {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.pop();
    for (const imported of outputs[current]?.imports ?? []) {
      if (imported.kind !== 'import-statement') continue;
      if (seen.has(imported.path)) continue;
      seen.add(imported.path);
      queue.push(imported.path);
    }
  }
  return seen;
}

function main() {
  if (DEFERRED_BLOCKS.length === 0) {
    console.error('assert-deferred-chunks: nothing declared — has the block list been emptied?');
    process.exit(2);
  }

  const stats = loadStats();
  const outputs = stats.outputs ?? {};
  const jsOutputs = Object.fromEntries(
    Object.entries(outputs).filter(([name]) => name.endsWith('.js'))
  );

  if (Object.keys(jsOutputs).length === 0) {
    console.error('assert-deferred-chunks: the build emitted no JavaScript chunks.');
    process.exit(2);
  }

  const failures = [];

  for (const { component, host, trigger } of DEFERRED_BLOCKS) {
    const componentChunk = chunkContaining(jsOutputs, component);
    const hostChunk = chunkContaining(jsOutputs, host);

    if (hostChunk === null) {
      failures.push(`${host}: not in the build at all — was it renamed or deleted?`);
      continue;
    }
    if (componentChunk === null) {
      failures.push(`${component}: not in the build at all — was it renamed or deleted?`);
      continue;
    }

    if (componentChunk === hostChunk) {
      failures.push(
        `${component}: bundled into the same chunk as ${host} (${hostChunk}). ` +
          `Its "@defer (${trigger})" block is not deferring anything — something outside ` +
          `the block references the component or its module.`
      );
      continue;
    }

    if (staticClosure(jsOutputs, hostChunk).has(componentChunk)) {
      failures.push(
        `${component}: its chunk (${componentChunk}) is reachable from ${host}'s ` +
          `(${hostChunk}) through static imports, so it downloads with the host ` +
          `regardless of "@defer (${trigger})".`
      );
      continue;
    }

    const dynamicallyImported = (jsOutputs[hostChunk].imports ?? []).some(
      (imported) => imported.kind === 'dynamic-import' && imported.path === componentChunk
    );
    if (!dynamicallyImported) {
      failures.push(
        `${component}: ${host}'s chunk (${hostChunk}) does not dynamically import ` +
          `${componentChunk}. The "@defer (${trigger})" block appears to be gone.`
      );
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`::error::${failure}`);
    }
    console.error('See docs/defer.md for what makes a @defer block silently eager.');
    process.exit(1);
  }

  console.log(
    `assert-deferred-chunks: clean (${DEFERRED_BLOCKS.length} @defer block(s) checked, ` +
      `each in its own dynamically-imported chunk)`
  );
}

main();
