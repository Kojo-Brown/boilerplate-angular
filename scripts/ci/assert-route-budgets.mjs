#!/usr/bin/env node
// Audit route-level code splitting, and fail when a route costs more JavaScript than it
// is budgeted.
//
// `angular.json` budgets the *initial* bundle, which is the cost of the first paint and
// nothing else. Every feature in this repo is behind a lazy route, so the initial budget
// is blind to the thing route splitting was done for: what a user pays on top of it to
// actually reach a page. A route's chunk can double, or start dragging a 100 kB library
// in through a shared chunk, and `initial` does not move by a byte.
//
// ## What a route costs
//
// Not "the size of its chunk". Reaching `/dashboard/posts` means loading the chunk for
// `dashboard.routes.ts`, then the shell component's, then the list component's — each of
// which statically imports further chunks that arrive with it. The honest number is the
// union of all of that: every chunk the browser has downloaded once the route is on
// screen, counted once, minus what the initial bundle already provided.
//
// So each route below declares the chain of lazily-loaded source files the router walks
// to render it — the same sequence its `loadChildren`/`loadComponent` calls describe.
// Starting from the initial bundle's static closure, each step's chunk is added along
// with everything it statically imports, and the total beyond the initial closure is the
// route's cost. Steps are additive: the shell's chunks are counted once even though
// three routes load them, which is why `/dashboard/posts` costs 31 kB and not the 47 kB
// its three chunks add up to in isolation.
//
// ## What is asserted, beyond the number
//
//   1. Every lazily-imported entry in a `*.routes.ts` file appears in some chain here.
//      Without this the gate silently stops covering a route the moment one is added.
//   2. No step is already downloaded when the router reaches it — not from the initial
//      bundle (route code leaked into the eager graph) and not from an earlier step (two
//      routes' components merged into one chunk). Both are code-splitting regressions
//      that the initial budget cannot see, and the second one no budget can.
//   3. Every step is dynamically imported by something already loaded, so a chain that
//      has gone stale — a moved file, a route rewritten to import eagerly — fails here
//      instead of quietly measuring the wrong thing.
//
// Budgets are compared against raw bytes, like `angular.json`'s. Gzipped sizes are
// reported because they are what the user waits for, but they are not asserted on: see
// `transferBytes` in `lib/metafile.mjs`.
//
// Usage: node scripts/ci/assert-route-budgets.mjs
//        STATS_JSON=.stats/stats.json node scripts/ci/assert-route-budgets.mjs

import { appendFileSync } from 'node:fs';
import {
  APPLICATION_ENTRY_POINT,
  chunkContaining,
  chunkForEntryPoint,
  dynamicallyImports,
  formatKb,
  javascriptOutputs,
  loadBuild,
  parseBudget,
  staticClosure,
  totalBytes,
  transferBytes,
} from './lib/metafile.mjs';

/**
 * Every reachable route, the chain of lazily-loaded files the router walks to render it,
 * and the most JavaScript it may cost beyond the initial bundle.
 *
 * The chain mirrors the route config: one entry per `loadChildren`/`loadComponent` the
 * router calls, parent before child. Parent segments are included even when they render
 * nothing visible — `/dashboard/posts` renders inside `DashboardShellComponent`, so the
 * shell is downloaded whether or not the list is what the user asked for.
 *
 * Budgets are set a couple of kilobytes above the measured cost, on the same reasoning
 * as the `initial` budget in `angular.json`: the headroom is for noise, not for growth.
 * Crossing one is a prompt to look at what was just added to that route's graph. Raise a
 * number only with a reason, in the commit that earns it.
 *
 * Routes that only redirect (`''`, `**`) are absent on purpose: they load nothing.
 */
const ROUTE_BUDGETS = [
  {
    path: '/login',
    chain: ['src/app/features/auth/auth.routes.ts', 'src/app/features/auth/login.component.ts'],
    // By far the most expensive route in the application, and none of it is the login
    // form: the chunk it shares with /register is Zod v3 (51 kB) plus @angular/forms
    // (39 kB). `docs/route-budgets.md` covers what could be done about that.
    maximum: '112kB',
  },
  {
    path: '/register',
    chain: ['src/app/features/auth/auth.routes.ts', 'src/app/features/auth/register.component.ts'],
    maximum: '114kB',
  },
  {
    path: '/unauthorized',
    chain: ['src/app/features/errors/unauthorized.component.ts'],
    maximum: '2kB',
  },
  {
    path: '/dashboard',
    chain: [
      'src/app/features/dashboard/dashboard.routes.ts',
      'src/app/features/dashboard/dashboard-shell.component.ts',
      'src/app/features/dashboard/dashboard.component.ts',
    ],
    // The widget components and their sample data are in the `dashboard.routes.ts` chunk
    // rather than the board's, because the route's `providers` name them — see the
    // comment on `provideDashboardWidgets` there. That is why every dashboard route pays
    // for them, including the two that render no widgets.
    maximum: '31kB',
  },
  {
    path: '/dashboard/posts',
    chain: [
      'src/app/features/dashboard/dashboard.routes.ts',
      'src/app/features/dashboard/dashboard-shell.component.ts',
      'src/app/features/posts/posts-list.component.ts',
    ],
    maximum: '33kB',
  },
  {
    path: '/dashboard/posts/:id',
    chain: [
      'src/app/features/dashboard/dashboard.routes.ts',
      'src/app/features/dashboard/dashboard-shell.component.ts',
      'src/app/features/posts/post-detail.component.ts',
    ],
    maximum: '28kB',
  },
  {
    path: '/admin',
    chain: ['src/app/features/admin/admin.routes.ts', 'src/app/features/admin/admin.component.ts'],
    maximum: '2kB',
  },
];

/** Source files that hold a route config, by this repo's naming convention. */
const ROUTE_FILE_PATTERN = /^src\/app\/(?:.*\/)?[\w.-]+\.routes\.ts$/;

/** The root route config, and the reason a rename of it cannot go unnoticed. */
const ROOT_ROUTE_FILE = 'src/app/app.routes.ts';

/**
 * Every source file a route config lazily imports, according to the build.
 *
 * Read from the metafile rather than parsed out of the source: esbuild has already
 * resolved each `import()` specifier to a path and recorded whether it is a static or a
 * dynamic edge, so this is the resolver's answer rather than a second guess at it.
 */
function discoverLazyRouteEntries(stats) {
  const entries = new Map();
  let routeFiles = 0;
  let sawRootRouteFile = false;

  for (const [path, input] of Object.entries(stats.inputs ?? {})) {
    if (!ROUTE_FILE_PATTERN.test(path)) continue;
    routeFiles += 1;
    if (path === ROOT_ROUTE_FILE) sawRootRouteFile = true;
    for (const imported of input.imports ?? []) {
      if (imported.kind !== 'dynamic-import') continue;
      if (!entries.has(imported.path)) entries.set(imported.path, path);
    }
  }

  return { entries, routeFiles, sawRootRouteFile };
}

/**
 * Walk one route's chain, accumulating the chunks the browser has downloaded.
 *
 * @returns {{ chunks: Set<string>, failures: string[] }} `chunks` is everything loaded by
 *   the end of the walk, the initial closure included.
 */
function walkRoute({ path, chain }, outputs, initialClosure) {
  const failures = [];
  let loaded = new Set(initialClosure);

  for (const [index, source] of chain.entries()) {
    const chunk = chunkContaining(outputs, source);

    if (chunk === null) {
      failures.push(
        `${path}: ${source} is not in the build at all — was it renamed, deleted, or ` +
          `dropped from the route config?`
      );
      break;
    }

    if (loaded.has(chunk)) {
      const sharedWith = chain
        .slice(0, index)
        .find((earlier) => chunkContaining(outputs, earlier) === chunk);
      let reason;
      if (initialClosure.has(chunk)) {
        reason =
          `is in the initial bundle (${chunk}), so it downloads with the first paint ` +
          `whether or not anyone visits ${path}. Something in the eager graph references it`;
      } else if (sharedWith !== undefined) {
        reason =
          `shares chunk ${chunk} with ${sharedWith}, so it is no longer split from it. ` +
          `Route splitting has collapsed between the two`;
      } else {
        reason =
          `is in ${chunk}, which an earlier step of this route imports statically — so it ` +
          `arrives before the router asks for it, and every sibling route pays for it too`;
      }
      failures.push(`${path}: ${source} ${reason}.`);
      break;
    }

    if (![...loaded].some((candidate) => dynamicallyImports(outputs, candidate, chunk))) {
      failures.push(
        `${path}: nothing loaded by step ${index + 1} of this route dynamically imports ` +
          `${chunk} (${source}). Either the chain declared in ROUTE_BUDGETS is stale, or ` +
          `the route stopped loading it lazily.`
      );
      break;
    }

    loaded = staticClosure(outputs, chunk, loaded);
  }

  return { chunks: loaded, failures };
}

/** Render the audit as a Markdown table — the report half of this gate. */
function renderTable(rows) {
  const header = ['Route', 'Lazy JS', 'Transfer', 'Budget', 'Headroom', 'Cold start'];
  const body = rows.map((row) => [
    `\`${row.path}\``,
    formatKb(row.lazyBytes),
    row.transfer === null ? '—' : formatKb(row.transfer),
    formatKb(row.budget),
    formatKb(row.budget - row.lazyBytes),
    formatKb(row.totalBytes),
  ]);
  const widths = header.map((_, column) =>
    Math.max(header[column].length, ...body.map((cells) => cells[column].length))
  );
  const line = (cells) => `| ${cells.map((cell, i) => cell.padEnd(widths[i])).join(' | ')} |`;
  return [
    line(header),
    `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`,
    ...body.map(line),
  ].join('\n');
}

function main() {
  if (ROUTE_BUDGETS.length === 0) {
    console.error('assert-route-budgets: no routes declared — has the budget list been emptied?');
    process.exit(2);
  }

  const build = loadBuild();
  let report;
  try {
    const { stats, outputDir } = build;
    const outputs = javascriptOutputs(stats);

    if (Object.keys(outputs).length === 0) {
      console.error('assert-route-budgets: the build emitted no JavaScript chunks.');
      process.exit(2);
    }

    const entryChunk = chunkForEntryPoint(outputs, APPLICATION_ENTRY_POINT);
    if (entryChunk === null) {
      console.error(
        `assert-route-budgets: no output declares ${APPLICATION_ENTRY_POINT} as its entry ` +
          `point, so the initial bundle cannot be identified.`
      );
      process.exit(2);
    }
    const initialClosure = staticClosure(outputs, entryChunk);

    const failures = [];

    // Coverage first: a route with no budget is the failure mode this gate exists to
    // avoid, and it reads as a green run rather than as a gap.
    const { entries, routeFiles, sawRootRouteFile } = discoverLazyRouteEntries(stats);
    if (routeFiles === 0 || !sawRootRouteFile) {
      console.error(
        `assert-route-budgets: found ${routeFiles} route config file(s) and ` +
          `${sawRootRouteFile ? 'did' : 'did not'} see ${ROOT_ROUTE_FILE}. Route files are ` +
          `discovered by the \`*.routes.ts\` naming convention; update ROUTE_FILE_PATTERN if ` +
          `that has changed.`
      );
      process.exit(2);
    }

    const budgeted = new Set(ROUTE_BUDGETS.flatMap((route) => route.chain));
    for (const [entry, routeFile] of entries) {
      if (budgeted.has(entry)) continue;
      failures.push(
        `${entry} is lazily loaded by ${routeFile} but appears in no chain in ` +
          `ROUTE_BUDGETS, so nothing measures what that route costs. Add it.`
      );
    }
    for (const source of budgeted) {
      if (entries.has(source)) continue;
      failures.push(
        `${source} is declared in a ROUTE_BUDGETS chain but no \`*.routes.ts\` file lazily ` +
          `imports it. The chain is describing a route that no longer exists.`
      );
    }

    const rows = [];
    for (const route of ROUTE_BUDGETS) {
      const budget = parseBudget(route.maximum);
      const walk = walkRoute(route, outputs, initialClosure);
      failures.push(...walk.failures);
      if (walk.failures.length > 0) continue;

      const lazyChunks = [...walk.chunks].filter((chunk) => !initialClosure.has(chunk));
      const lazyBytes = totalBytes(outputs, lazyChunks);
      rows.push({
        path: route.path,
        lazyBytes,
        budget,
        transfer: transferBytes(outputDir, lazyChunks),
        // What a cold visit to this route downloads in total: the eager bundle, the
        // stylesheet that blocks its first paint, and everything the route added.
        totalBytes:
          lazyBytes +
          totalBytes(outputs, initialClosure) +
          Object.entries(stats.outputs ?? {})
            .filter(([name]) => name.endsWith('.css'))
            .reduce((bytes, [, output]) => bytes + (output.bytes ?? 0), 0),
      });

      if (lazyBytes > budget) {
        failures.push(
          `${route.path}: ${formatKb(lazyBytes)} of lazy JavaScript exceeds its ` +
            `${formatKb(budget)} budget by ${formatKb(lazyBytes - budget)}. Chunks beyond the ` +
            `initial bundle: ${lazyChunks
              .map((chunk) => `${chunk} (${formatKb(outputs[chunk].bytes)})`)
              .sort()
              .join(', ')}.`
        );
      }
    }

    report = rows.length > 0 ? renderTable(rows) : null;

    if (failures.length > 0) {
      for (const failure of failures) console.error(`::error::${failure}`);
      if (report !== null) console.error(`\n${report}`);
      console.error('\nSee docs/route-budgets.md for how a route cost is measured.');
      process.exit(1);
    }
  } finally {
    build.dispose();
  }

  console.log(`assert-route-budgets: clean (${ROUTE_BUDGETS.length} routes within budget)\n`);
  console.log(report);

  // Surface the audit on the pull request itself, not only in a job log nobody opens.
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Route bundle budgets\n\n${report}\n\n` +
        `"Lazy JS" is what each route downloads beyond the initial bundle; "Cold start" is ` +
        `everything a first visit to it fetches. See \`docs/route-budgets.md\`.\n`
    );
  }
}

main();
