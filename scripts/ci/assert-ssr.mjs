#!/usr/bin/env node
// Fail when server-side rendering has stopped happening.
//
// Every other gate in this directory reads a build artifact. This one runs it, because
// the things that break about SSR do not show up in a bundle: a browser-only global
// reached during a render, a provider that only exists on one platform, a route whose
// render mode quietly changed, a `@defer (hydrate …)` block that no longer arrives
// dehydrated. All of those still compile, still pass every unit spec — which run in a
// browser, where none of them is reachable — and still produce a `dist/` that looks
// right. The only place the answer exists is in the bytes the server sends.
//
// ## What it checks
//
//   1. The build emitted both halves: a browser graph, a server graph, and a CSR shell.
//      The two graphs use disjoint extensions (`.js` / `.mjs`), which the bundle gates in
//      `lib/metafile.mjs` rely on to tell one module graph from the other.
//   2. The routes declared `RenderMode.Prerender` are exactly the routes that were
//      prerendered, and each has an `index.html` with rendered content in it.
//   3. The prerendered `/login` is *hydratable* — it carries Angular's hydration
//      annotations and the event-replay contract — and its form arrives as a *dehydrated*
//      block, with the `jsaction` attributes that make the first click hydrate it. That
//      is the whole claim of incremental hydration, and it is invisible in `dist/` any
//      other way: the server renders the block's content whether or not it is deferred.
//   4. Against a running server: a prerendered route is served, a `RenderMode.Client`
//      route is served as the shell and not rendered, the router's redirects resolve
//      server-side, and a request carrying a `Host` outside `NG_ALLOWED_HOSTS` is
//      rejected.
//   5. The server refuses to start when `NG_ALLOWED_HOSTS` is unset, rather than starting
//      and rejecting every request (see `src/server.ts`).
//
// Usage: node scripts/ci/assert-ssr.mjs [dist-dir]
//        (default: dist/boilerplate-angular, matching `outputPath` in angular.json)

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const distDir = resolve(repoRoot, process.argv[2] ?? 'dist/boilerplate-angular');

/**
 * The routes `app.routes.server.ts` declares `RenderMode.Prerender`.
 *
 * Hand-maintained, like the block list in `assert-deferred-chunks.mjs` and for the same
 * reason: a render mode is a decision about where a page's data lives, and moving one is
 * the kind of edit that should have to be made twice. Checked in both directions below,
 * so adding a prerendered route without touching this file fails just as loudly as
 * losing one.
 */
const PRERENDERED_ROUTES = ['/login', '/register', '/unauthorized'];

/** A route that must *not* be prerendered, and a string only its rendered output has. */
const CLIENT_ROUTE = { path: '/dashboard', contentMarker: 'Dashboard' };

/** Where the router's own redirects should land, resolved on the server. */
const SERVER_REDIRECTS = [
  { from: '/', to: '/dashboard' },
  { from: '/no-such-page', to: '/dashboard' },
];

const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
  return condition;
}

/** Every emitted file under a directory, as paths relative to it. */
function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map((name) => String(name))
    .filter((name) => statSync(join(dir, name)).isFile());
}

// ---------------------------------------------------------------------------
// 1. Both halves of the build exist, and their module graphs are distinguishable.
// ---------------------------------------------------------------------------

function checkBuildShape() {
  const browserFiles = filesUnder(join(distDir, 'browser'));
  const serverFiles = filesUnder(join(distDir, 'server'));

  if (!check(browserFiles.length > 0, `${distDir}/browser is missing or empty — did the build run?`))
    return;
  if (
    !check(
      serverFiles.length > 0,
      `${distDir}/server is missing or empty. Without it there is no SSR: check ` +
        `"server", "ssr" and "outputMode" in the build options in angular.json.`
    )
  )
    return;

  check(
    existsSync(join(distDir, 'server', 'server.mjs')),
    `${distDir}/server/server.mjs is missing — "ssr": { "entry": "src/server.ts" } is ` +
      `what emits it.`
  );
  check(
    existsSync(join(distDir, 'browser', 'index.csr.html')),
    `${distDir}/browser/index.csr.html is missing. It is the shell every ` +
      `RenderMode.Client route is served, so without it those routes have nothing to send.`
  );

  // The premise `javascriptOutputs()` in lib/metafile.mjs rests on: one metafile holds
  // both graphs, and extension is what separates them. If the builder ever emits `.js`
  // on the server side, the bundle gates start measuring the wrong artifact silently —
  // so it is asserted here rather than assumed there.
  const serverJs = serverFiles.filter((name) => name.endsWith('.js'));
  const browserMjs = browserFiles.filter((name) => name.endsWith('.mjs'));
  check(
    serverJs.length === 0 && browserMjs.length === 0,
    `the browser and server builds no longer use disjoint extensions ` +
      `(server/*.js: ${serverJs.length}, browser/*.mjs: ${browserMjs.length}). ` +
      `assert-deferred-chunks.mjs and assert-route-budgets.mjs read one metafile holding ` +
      `both graphs and tell them apart this way — see javascriptOutputs() in ` +
      `scripts/ci/lib/metafile.mjs.`
  );
}

// ---------------------------------------------------------------------------
// 2 & 3. Prerendered output, and the hydration annotations in it.
// ---------------------------------------------------------------------------

function checkPrerenderedRoutes() {
  const manifestPath = join(distDir, 'prerendered-routes.json');
  if (!check(existsSync(manifestPath), `${manifestPath} is missing — nothing was prerendered.`)) {
    return;
  }

  const prerendered = Object.keys(JSON.parse(readFileSync(manifestPath, 'utf8')).routes ?? {});

  for (const route of PRERENDERED_ROUTES) {
    check(
      prerendered.includes(route),
      `${route} is declared RenderMode.Prerender in app.routes.server.ts but the build ` +
        `did not prerender it. Prerendered: ${prerendered.join(', ') || '(none)'}.`
    );
  }
  for (const route of prerendered) {
    check(
      PRERENDERED_ROUTES.includes(route),
      `${route} was prerendered but is not listed in PRERENDERED_ROUTES here, so nothing ` +
        `checks what it renders. Add it.`
    );
  }

  for (const route of PRERENDERED_ROUTES) {
    const file = join(distDir, 'browser', route.replace(/^\//, ''), 'index.html');
    if (!check(existsSync(file), `${route} has no prerendered index.html at ${file}.`)) continue;

    const html = readFileSync(file, 'utf8');
    check(
      !/<app-root[^>]*>\s*<\/app-root>/.test(html),
      `${route} prerendered to an empty <app-root>. The route produced a file but no ` +
        `markup, which is a render that failed quietly rather than a route that is static.`
    );
    check(
      html.includes('ng-server-context='),
      `${route} carries no ng-server-context attribute, so it was not produced by the ` +
        `server renderer.`
    );
    check(
      / ngh="/.test(html),
      `${route} carries no "ngh" hydration annotations. The browser will discard this ` +
        `markup and render the page again — check provideClientHydration() in app.config.ts.`
    );
  }
}

/**
 * The incremental-hydration claim, checked against the bytes.
 *
 * `ngb` marks a dehydrated `@defer` block and the `jsaction` attribute beside it is the
 * trigger surface the event contract watches. Both are absent from an ordinary hydrated
 * render, and — this is the point — the *content* is identical either way, so nothing
 * else distinguishes "the form is deferred" from "the form is not deferred any more".
 */
function checkIncrementalHydration() {
  const file = join(distDir, 'browser', 'login', 'index.html');
  if (!existsSync(file)) return; // already reported above
  const html = readFileSync(file, 'utf8');

  check(
    html.includes('id="ng-event-dispatch-contract"'),
    `/login does not carry the event-replay contract script. Without it the click that ` +
      `triggers hydration of the sign-in form is dropped rather than replayed — ` +
      `withEventReplay() in app.config.ts is what emits it.`
  );
  check(
    /<app-login-form[^>]*\sngb="/.test(html),
    `/login renders <app-login-form> but not as a dehydrated block (no "ngb" attribute). ` +
      `The "@defer (hydrate on interaction)" in login.component.ts is hydrating eagerly, ` +
      `so the form's ~108 kB of @angular/forms and Zod downloads on page load after all. ` +
      `See docs/ssr.md.`
  );
  check(
    /<app-login-form[^>]*jsaction="[^"]*click:/.test(html),
    `/login's sign-in form has no "click" jsaction, so nothing on the page will trigger ` +
      `its hydration. The block would only load on the compiler's implicit "on idle".`
  );
  check(
    html.includes('autocomplete="current-password"'),
    `/login's password field is not in the prerendered markup. A hydrate trigger renders ` +
      `the block's main content on the server; a placeholder instead means the block is ` +
      `being deferred rather than dehydrated.`
  );
  check(
    !/<button[^>]*type="submit"/.test(html),
    `/login prerenders a type="submit" button inside a dehydrated block. Angular does ` +
      `not preventDefault a pre-hydration click on anything but an <a>, so that button ` +
      `performs a native form submission and throws away what the visitor typed. See the ` +
      `header of login-form.component.ts.`
  );
}

// ---------------------------------------------------------------------------
// 4 & 5. The server, running.
// ---------------------------------------------------------------------------

/** An ephemeral port the OS has just confirmed is free. */
function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });
}

function startServer(port, env) {
  const child = spawn(process.execPath, [join(distDir, 'server', 'server.mjs')], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  return { child, readOutput: () => output };
}

/**
 * A GET carrying an arbitrary `Host`, over `node:http` rather than `fetch`.
 *
 * `Host` is a forbidden header name for `fetch`, which drops it silently — so the
 * spoofed-host probe below would otherwise send the real host, get a 200, and read as
 * "the guard is off" when it is simply untested. Only the status code is needed.
 */
function rawGet(port, path, host) {
  return new Promise((resolveStatus, reject) => {
    const request = httpRequest(
      { host: '127.0.0.1', port, path, method: 'GET', headers: { Host: host } },
      (response) => {
        response.resume();
        response.once('end', () => resolveStatus(response.statusCode));
      }
    );
    request.once('error', reject);
    request.end();
  });
}

/** Poll until the server answers, or give up. Returns `false` if it never came up. */
async function waitForServer(port, child, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    try {
      await fetch(`http://127.0.0.1:${port}/login`, { headers: { host: '127.0.0.1' } });
      return true;
    } catch {
      await new Promise((done) => setTimeout(done, 250));
    }
  }
  return false;
}

async function checkRunningServer() {
  const port = await freePort();
  // The host the requests below will carry. Allow-listing it is the deployment step
  // `src/server.ts` refuses to start without, so exercising it here is also the only
  // place that step is documented by something that runs.
  const { child, readOutput } = startServer(port, { NG_ALLOWED_HOSTS: '127.0.0.1' });

  try {
    if (!(await waitForServer(port, child))) {
      failures.push(
        `the server never answered on 127.0.0.1:${port}. Output:\n${readOutput().trim() || '(none)'}`
      );
      return;
    }

    const get = (path, headers = {}) =>
      fetch(`http://127.0.0.1:${port}${path}`, {
        redirect: 'manual',
        headers: { host: '127.0.0.1', ...headers },
      });

    const login = await get('/login');
    check(login.status === 200, `GET /login returned ${login.status}, expected 200.`);
    const loginBody = await login.text();
    check(
      loginBody.includes('Welcome back') && loginBody.includes('ng-server-context='),
      `GET /login did not return the prerendered page. The static file exists, so the ` +
        `server is not matching the route to it.`
    );

    const client = await get(CLIENT_ROUTE.path);
    check(
      client.status === 200,
      `GET ${CLIENT_ROUTE.path} returned ${client.status}, expected 200.`
    );
    const clientBody = await client.text();
    check(
      /<app-root[^>]*>\s*<\/app-root>/.test(clientBody),
      `GET ${CLIENT_ROUTE.path} did not return an empty <app-root>. It is declared ` +
        `RenderMode.Client because the server cannot see the session; rendering it there ` +
        `serves a signed-out frame the client then replaces. See app.routes.server.ts.`
    );
    check(
      !clientBody.includes(CLIENT_ROUTE.contentMarker),
      `GET ${CLIENT_ROUTE.path} returned rendered content ("${CLIENT_ROUTE.contentMarker}"), ` +
        `so an authenticated route is being server-rendered for an anonymous request.`
    );

    for (const { from, to } of SERVER_REDIRECTS) {
      const response = await get(from);
      check(
        response.status === 302,
        `GET ${from} returned ${response.status}, expected a 302 — the router's redirect ` +
          `should be resolved on the server.`
      );
      check(
        (response.headers.get('location') ?? '').endsWith(to),
        `GET ${from} redirected to "${response.headers.get('location')}", expected ${to}.`
      );
    }

    // The SSRF guard, from the outside. A `Host` nobody allow-listed must not render.
    const spoofed = await rawGet(port, '/login', 'evil.example.com');
    check(
      spoofed === 400,
      `GET /login with Host: evil.example.com returned ${spoofed}, expected 400. ` +
        `Angular validates Host and X-Forwarded-Host against NG_ALLOWED_HOSTS; a 200 here ` +
        `means that check is off.`
    );
  } finally {
    child.kill('SIGTERM');
  }
}

/** The unconfigured server must fail at startup, not one request at a time. */
async function checkStartupRefusesWithoutAllowedHosts() {
  const port = await freePort();
  const { child, readOutput } = startServer(port, { NG_ALLOWED_HOSTS: '' });

  const exitCode = await new Promise((done) => {
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      done(null);
    }, 30_000);
    child.once('exit', (code) => {
      clearTimeout(timer);
      done(code);
    });
  });

  check(
    exitCode !== 0 && exitCode !== null,
    `the server started with NG_ALLOWED_HOSTS unset (exit code ${exitCode}). It would ` +
      `then answer every request with a 400 about server-side request forgery, which ` +
      `reads as an attack rather than as missing configuration. See src/server.ts.`
  );
  check(
    readOutput().includes('NG_ALLOWED_HOSTS'),
    `the server's startup failure does not name NG_ALLOWED_HOSTS, so the message does not ` +
      `say what to set. Output:\n${readOutput().trim() || '(none)'}`
  );
}

async function main() {
  if (!existsSync(distDir)) {
    console.error(`assert-ssr: no such directory: ${distDir} — run \`pnpm build\` first.`);
    process.exit(2);
  }

  checkBuildShape();
  checkPrerenderedRoutes();
  checkIncrementalHydration();
  await checkRunningServer();
  await checkStartupRefusesWithoutAllowedHosts();

  if (failures.length > 0) {
    for (const failure of failures) console.error(`::error::${failure}`);
    console.error('\nSee docs/ssr.md for what each render mode promises.');
    process.exit(1);
  }

  console.log(
    `assert-ssr: clean (${PRERENDERED_ROUTES.length} prerendered route(s) verified, ` +
      `${CLIENT_ROUTE.path} served as the shell, incremental hydration live on /login)`
  );
}

await main();
