// Shared reader for the esbuild metafile the Angular builder writes as `stats.json`.
//
// Two gates need the same three facts about a production build — which output chunk a
// source file landed in, which chunks a chunk drags in statically, and how big the
// result is — so they read it from one place rather than each growing their own copy.
// `assert-deferred-chunks.mjs` asks whether a `@defer` block still splits a chunk;
// `assert-route-budgets.mjs` asks what a route costs. Both questions only have answers
// in the build output: minification erases the module boundaries, and the metafile is
// the only artifact that maps them back to source paths.
//
// ## The metafile shape this relies on
//
//   outputs['chunk-X.js'] = {
//     bytes: 1234,                    // size of the emitted file
//     entryPoint: 'src/…/x.ts',       // present only for chunks that are an entry
//     inputs: { 'src/…/y.ts': { bytesInOutput } },   // sources bundled into it
//     imports: [{ path: 'chunk-Y.js', kind: 'import-statement' | 'dynamic-import' }],
//   }
//
// `kind` is the load that matters. `import-statement` means the importing chunk cannot
// run without the imported one, so the browser fetches both together; `dynamic-import`
// means it fetches the second only if and when something calls the `import()`. Every
// question about lazy loading in this repo reduces to which of those two edges connects
// a pair of chunks.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

/** Absolute path to the repository root, independent of the caller's cwd. */
export const repoRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

/** The source file the application's eager bundle is built from. */
export const APPLICATION_ENTRY_POINT = 'src/main.ts';

/**
 * A production build's metafile, plus the directory its outputs live in.
 *
 * `pnpm build` deliberately does not pass `--stats-json`: the metafile maps every output
 * chunk back to the source paths that went into it, which is the one thing minification
 * takes away, and it would ship inside `dist/` next to the bundles. So a gate either
 * gets pointed at a metafile that already exists, or produces its own.
 *
 * Set `STATS_JSON` to reuse a build — which is how CI runs both gates off one `pnpm
 * stats`, and the fast path when iterating locally:
 *
 *   pnpm stats && STATS_JSON=.stats/stats.json pnpm check:routes
 *
 * Without it this runs its own production build into a scratch directory. Call
 * `dispose()` when done; the emitted files are needed until then, because transfer
 * sizes are measured from the files themselves rather than from the metafile.
 *
 * @returns {{ stats: object, outputDir: string, dispose: () => void }}
 */
export function loadBuild() {
  const existing = process.env.STATS_JSON;
  if (existing) {
    const statsPath = resolve(repoRoot, existing);
    return {
      stats: JSON.parse(readFileSync(statsPath, 'utf8')),
      outputDir: dirname(statsPath),
      dispose: () => {},
    };
  }

  const scratch = mkdtempSync(join(tmpdir(), 'ng-stats-'));
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
        scratch,
      ],
      { cwd: repoRoot, stdio: ['ignore', 'ignore', 'inherit'] }
    );
    return {
      stats: JSON.parse(readFileSync(join(scratch, 'stats.json'), 'utf8')),
      outputDir: scratch,
      dispose: () => rmSync(scratch, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(scratch, { recursive: true, force: true });
    throw error;
  }
}

/**
 * The **browser** JavaScript outputs of a build, keyed by file name.
 *
 * Two things are filtered out, for different reasons.
 *
 * Stylesheets, because the import graph below is a graph of ES modules: a component's
 * styles are inlined into its chunk, and the one global stylesheet is an initial file
 * with no edges. Anything that needs the CSS asks `stats.outputs` directly.
 *
 * And the server build. Since SSR was turned on, one `ng build` emits two module graphs
 * into one metafile — `dist/<project>/browser` and `dist/<project>/server` — and almost
 * every source file appears in both. Every question these gates ask is about what a
 * *browser* downloads, so a server chunk answering `chunkContaining()` first would make
 * a route's cost, or a `@defer` block's split, a measurement of the wrong artifact. The
 * two sets are told apart by extension: the browser build emits `.js` and the server
 * build `.mjs`, with no overlap in either direction (`assert-ssr.mjs` re-checks that
 * against the emitted files, so this stays an observation about the builder rather than
 * an assumption about it).
 */
export function javascriptOutputs(stats) {
  return Object.fromEntries(
    Object.entries(stats.outputs ?? {}).filter(([name]) => name.endsWith('.js'))
  );
}

/** The output chunk a source file was bundled into, or `null` if it was not bundled. */
export function chunkContaining(outputs, sourcePath) {
  for (const [name, output] of Object.entries(outputs)) {
    if (Object.hasOwn(output.inputs ?? {}, sourcePath)) return name;
  }
  return null;
}

/** The chunk built from `entryPoint`, or `null` when no output declares it. */
export function chunkForEntryPoint(outputs, entryPoint) {
  for (const [name, output] of Object.entries(outputs)) {
    if (output.entryPoint === entryPoint) return name;
  }
  return null;
}

/**
 * Every chunk reachable from `start` by following static imports, `start` included.
 *
 * This is the set the browser has to have in memory before `start` can run, so it is
 * also the unit of "what one download costs". Transitive on purpose: a static edge does
 * not have to be direct. A component pulled in through a barrel file, or through a
 * second component imported eagerly, is one hop further away and arrives just the same.
 *
 * Pass `seed` to accumulate across several starting points — chunks already in it are
 * neither revisited nor re-counted, which is what makes a route's steps additive.
 */
export function staticClosure(outputs, start, seed = new Set()) {
  const seen = new Set(seed);
  const queue = [start];
  seen.add(start);
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

/** Whether `chunk` dynamically imports `target` — the edge `@defer` and lazy routes emit. */
export function dynamicallyImports(outputs, chunk, target) {
  return (outputs[chunk]?.imports ?? []).some(
    (imported) => imported.kind === 'dynamic-import' && imported.path === target
  );
}

/** Total emitted size of a set of chunks, in bytes. */
export function totalBytes(outputs, chunks) {
  let bytes = 0;
  for (const chunk of chunks) bytes += outputs[chunk]?.bytes ?? 0;
  return bytes;
}

/**
 * Gzipped size of a set of outputs, in bytes — what the browser actually pulls down.
 *
 * Reported, never asserted on. zlib's output is a function of the compression level and
 * the zlib build, so this number can move a few bytes between Node majors while not one
 * byte of the application changed; a budget that shifts under the runtime is a flake.
 * The raw sizes above are the same everywhere, so they are what the gates compare.
 *
 * `null` when the emitted files are not next to the metafile — pointing `STATS_JSON` at
 * a bare metafile is legitimate, and losing a reported column is not worth an error.
 */
export function transferBytes(outputDir, names) {
  let bytes = 0;
  for (const name of names) {
    // The application builder writes browser output under `browser/` and the metafile
    // beside it, so names in `outputs` are relative to that subdirectory.
    const candidates = [join(outputDir, 'browser', name), join(outputDir, name)];
    const file = candidates.find((candidate) => existsSync(candidate));
    if (file === undefined) return null;
    bytes += gzipSync(readFileSync(file), { level: 9 }).byteLength;
  }
  return bytes;
}

/** Format bytes the way the Angular CLI's build summary does, so numbers are comparable. */
export function formatKb(bytes) {
  return `${(bytes / 1000).toFixed(2)} kB`;
}

/**
 * Parse a budget written the way `angular.json` writes one — `"565kB"`, `"1.5 MB"`, or a
 * plain byte count. Throws on anything else rather than silently treating a typo as zero.
 */
export function parseBudget(budget) {
  if (typeof budget === 'number') return budget;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb)?\s*$/i.exec(budget);
  if (match === null) throw new Error(`Unparseable budget: ${JSON.stringify(budget)}`);
  const scale = { b: 1, kb: 1000, mb: 1000 * 1000 }[(match[2] ?? 'b').toLowerCase()];
  return Number(match[1]) * scale;
}
