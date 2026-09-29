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
//   3b. The prerendered `/login` and `/register` carry a `<link rel="preload" as="image">`
//      for their LCP image. That link is the entire point of marking the banner
//      `priority` on a prerendered page — it starts the fetch from the static HTML — and
//      it exists only in the server render, so no browser-run spec can see it.
//   4. Against a running server: a prerendered route is served, a `RenderMode.Client`
//      route is served as the shell and not rendered, the router's redirects resolve
//      server-side, and a request carrying a `Host` outside `NG_ALLOWED_HOSTS` is
//      rejected.
//   5. The server refuses to start when `NG_ALLOWED_HOSTS` is unset, rather than starting
//      and rejecting every request (see `src/server.ts`).
//   6. Each locale's prerendered HTML is actually in that locale: `lang`/`dir` on `<html>`,
//      and translated text in the body. Both are properties of the emitted bytes and of
//      nothing else — the unit suite runs against the source locale, where an untranslated
//      string is the correct output, so this is the only gate that can see a translation
//      file that was configured but never applied.
//
// ## Locales
//
// `localize` is on for the production build, so one `ng build` emits one browser and one
// server graph *per locale* under `browser/<locale>/` and `server/<locale>/`, every route
// moves under a locale prefix, and `/` becomes a redirect to the default locale's base
// href. Everything below is therefore parameterised by locale rather than assuming `/`
// is the application's root: see `docs/i18n.md`.
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

/**
 * The locales `angular.json` configures, source locale first.
 *
 * Hand-maintained for the same reason `PRERENDERED_ROUTES` is: adding a locale doubles
 * the build output and moves every URL, which should have to be written down twice.
 */
const LOCALES = ['en-US', 'ar'];

/** The locale `/` redirects to, and the one the unprefixed checks below use. */
const [DEFAULT_LOCALE] = LOCALES;

/**
 * Locales that are written right to left, and must say so in the markup they ship.
 *
 * Angular sets `lang` and `dir` on `<html>` from the locale, which means nothing in this
 * repository can get them wrong — and also that nothing in this repository would notice if
 * a framework upgrade stopped setting them. Hence the assertion.
 */
const RTL_LOCALES = new Set(['ar']);

/**
 * A string that must appear in each locale's prerendered `/login`.
 *
 * This is the one check that proves the translation file reached the artifact. A locale
 * whose `.xlf` was mis-referenced, or whose targets were left empty, builds cleanly and
 * ships the English source text — `i18nMissingTranslation: "error"` catches a message with
 * no entry, not an entry that says the same thing.
 */
const LOCALE_CONTENT_MARKER = {
  'en-US': 'Welcome back',
  ar: 'أهلًا بعودتك',
};

/** `/login` for every locale, `/ar/login` and so on. */
const localised = (route) => LOCALES.map((locale) => `/${locale}${route}`);

/** Where a prerendered route's `index.html` is emitted for a locale. */
const prerenderedFile = (locale, route) =>
  join(distDir, 'browser', locale, route.replace(/^\//, ''), 'index.html');

/**
 * Prerendered routes that carry a `priority` image, and the source it must be preloaded at.
 *
 * `NgOptimizedImage` emits the preload link only while rendering on the server, so this is
 * the one place the claim can be checked. It is asserted per route rather than globally
 * because the failure it guards against is per route: dropping `<app-brand-banner />` from
 * one page, or letting the component lose its `priority`, leaves every other page's link
 * in place and the initial bundle untouched.
 */
const PRELOADED_IMAGES = [
  { route: '/login', src: '/img/auth-banner.png' },
  { route: '/register', src: '/img/auth-banner.png' },
];

/** The base href each locale is served under, which is also its URL prefix. */
const baseHrefOf = (locale) => `/${locale}/`;

/** A route that must *not* be prerendered, and a string only its rendered output has. */
const CLIENT_ROUTE = {
  path: `/${DEFAULT_LOCALE}/dashboard`,
  contentMarker: 'Dashboard',
};

/**
 * Where the router's own redirects should land, resolved on the server.
 *
 * `/` is not one of them any more, and that is the visible half of turning `localize` on:
 * the application no longer has a root. `@angular/ssr`'s app engine answers `/` with a
 * redirect to the default locale's base href, and only inside a locale does the router
 * get to resolve anything — which is why the wildcard redirect is checked at
 * `/<locale>/no-such-page` rather than at `/no-such-page`, where there is no application.
 */
const SERVER_REDIRECTS = [
  { from: `/${DEFAULT_LOCALE}/`, to: `/${DEFAULT_LOCALE}/dashboard` },
  { from: `/${DEFAULT_LOCALE}/no-such-page`, to: `/${DEFAULT_LOCALE}/dashboard` },
];

/** `/` belongs to no locale, so it redirects to the default one's base href. */
const LOCALE_ROOT_REDIRECT = { from: '/', to: DEFAULT_LOCALE };

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
  // One shell per locale. With `localize` on there is no `browser/index.csr.html` at all:
  // the shell is a rendered document, so it has a language, and a single shared one would
  // serve the source locale's markup to every visitor until the bundle booted.
  for (const locale of LOCALES) {
    check(
      existsSync(join(distDir, 'browser', locale, 'index.csr.html')),
      `${distDir}/browser/${locale}/index.csr.html is missing. It is the shell every ` +
        `RenderMode.Client route is served in ${locale}, so without it those routes have ` +
        `nothing to send.`
    );
  }

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
  const expected = PRERENDERED_ROUTES.flatMap(localised);

  for (const route of expected) {
    check(
      prerendered.includes(route),
      `${route} is declared RenderMode.Prerender in app.routes.server.ts but the build ` +
        `did not prerender it. Prerendered: ${prerendered.join(', ') || '(none)'}. ` +
        `Every prerendered route exists once per locale in LOCALES.`
    );
  }
  for (const route of prerendered) {
    check(
      expected.includes(route),
      `${route} was prerendered but is not listed in PRERENDERED_ROUTES × LOCALES here, ` +
        `so nothing checks what it renders. Add it.`
    );
  }

  for (const locale of LOCALES) {
    for (const route of PRERENDERED_ROUTES) {
      checkPrerenderedDocument(locale, route);
    }
  }
}

/** One locale's copy of one prerendered route. */
function checkPrerenderedDocument(locale, route) {
  {
    const file = prerenderedFile(locale, route);
    const url = `/${locale}${route}`;
    if (!check(existsSync(file), `${url} has no prerendered index.html at ${file}.`)) return;

    const html = readFileSync(file, 'utf8');
    checkLocaleMarkup(locale, url, html);
    const route_ = url;
    check(
      !/<app-root[^>]*>\s*<\/app-root>/.test(html),
      `${route_} prerendered to an empty <app-root>. The route produced a file but no ` +
        `markup, which is a render that failed quietly rather than a route that is static.`
    );
    check(
      html.includes('ng-server-context='),
      `${route_} carries no ng-server-context attribute, so it was not produced by the ` +
        `server renderer.`
    );
    check(
      / ngh="/.test(html),
      `${route_} carries no "ngh" hydration annotations. The browser will discard this ` +
        `markup and render the page again — check provideClientHydration() in app.config.ts.`
    );
    check(
      html.includes(`<base href="${baseHrefOf(locale)}">`),
      `${route_} does not declare <base href="${baseHrefOf(locale)}">. Every relative URL ` +
        `on the page — each chunk, each stylesheet — resolves against it, so a wrong base ` +
        `href serves one locale's document with another locale's bundle.`
    );
  }
}

/**
 * Rule 6: the document says which language it is in, and is in it.
 *
 * `lang` and `dir` are set by Angular from the locale, so this is not checking this
 * application's code — it is checking that a framework upgrade has not stopped doing it.
 * Both matter beyond typography: `lang` is what a screen reader picks a voice from, and
 * `dir` is what every logical CSS property in `src/` resolves against
 * (`assert-logical-properties.mjs` exists to keep that the only thing they need).
 */
function checkLocaleMarkup(locale, url, html) {
  const direction = RTL_LOCALES.has(locale) ? 'rtl' : 'ltr';

  check(
    new RegExp(`<html[^>]*\\blang="${locale}"`).test(html),
    `${url} does not carry lang="${locale}" on <html>. A screen reader picks its voice ` +
      `from that attribute, so without it Arabic is read out by an English synthesiser.`
  );
  check(
    new RegExp(`<html[^>]*\\bdir="${direction}"`).test(html),
    `${url} does not carry dir="${direction}" on <html>. Every ms-/me-/ps-/pe-/start-/end- ` +
      `utility in the application resolves against it, so the whole layout silently ` +
      `reverts to a left-to-right reading.`
  );

  const marker = LOCALE_CONTENT_MARKER[locale];
  if (marker === undefined || !url.endsWith('/login')) return;
  check(
    html.includes(marker),
    `${url} does not contain ${JSON.stringify(marker)}, so its translation file did not ` +
      `reach the build. A locale whose targets are empty, or whose .xlf is not the one ` +
      `angular.json points at, compiles cleanly and ships the English source text — ` +
      `i18nMissingTranslation catches a missing message, not a message left untranslated.`
  );
}

/**
 * The `priority` image claim, checked against the prerendered bytes.
 *
 * Three separate things have to be true and each fails independently: the `<img>` is in the
 * markup at all, it is eager rather than lazy, and the `<link rel="preload">` went into the
 * `<head>`. The last is the one that only exists on the server — a browser-run spec can
 * assert `loading="eager"` and `fetchpriority="high"` (and `brand-banner.component.spec.ts`
 * does) but never the link, because `PreloadLinkCreator` is server-only.
 */
function checkPriorityImagePreloads() {
  // The source locale only. The preload link is emitted by the renderer, not by the
  // translation, so checking it once per locale would be the same assertion run twice.
  for (const { route, src } of PRELOADED_IMAGES) {
    const file = prerenderedFile(DEFAULT_LOCALE, route);
    if (!existsSync(file)) continue; // already reported by checkPrerenderedRoutes
    const html = readFileSync(file, 'utf8');

    const image = new RegExp(`<img[^>]*src="${src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`);
    const tag = html.match(image)?.[0];

    if (
      !check(
        tag !== undefined,
        `${route} was prerendered without an <img src="${src}">. Either the component is ` +
          `gone from the page, or NgOptimizedImage is not applying and the element kept a ` +
          `literal ngsrc attribute with no src at all — see docs/images.md.`
      )
    ) {
      continue;
    }

    check(
      tag.includes('loading="eager"') && tag.includes('fetchpriority="high"'),
      `${route}'s ${src} is prerendered without loading="eager" fetchpriority="high", so ` +
        `it has lost its \`priority\`. The browser will defer the page's largest image ` +
        `until the parser reaches the tag.`
    );

    // Matched as a `<link>` carrying all three, in any attribute order — Angular's
    // renderer does not promise one, and asserting on a fixed order would make this gate
    // fail on a framework upgrade that changed nothing observable.
    const preload = html
      .match(/<link\b[^>]*>/g)
      ?.find(
        (link) =>
          link.includes('rel="preload"') &&
          link.includes('as="image"') &&
          link.includes(`href="${src}"`)
      );

    check(
      preload !== undefined,
      `${route} has no <link rel="preload" as="image" href="${src}"> in its prerendered ` +
        `HTML. That link is what makes \`priority\` worth anything on a prerendered page: ` +
        `without it the request waits for the parser to reach the <img>. It is emitted by ` +
        `NgOptimizedImage during server rendering only, so nothing else can catch its loss.`
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
  const file = prerenderedFile(DEFAULT_LOCALE, '/login');
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
      await fetch(`http://127.0.0.1:${port}/${DEFAULT_LOCALE}/login`, {
        headers: { host: '127.0.0.1' },
      });
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

    for (const locale of LOCALES) {
      const url = `/${locale}/login`;
      const login = await get(url);
      check(login.status === 200, `GET ${url} returned ${login.status}, expected 200.`);
      const loginBody = await login.text();
      check(
        loginBody.includes(LOCALE_CONTENT_MARKER[locale]) &&
          loginBody.includes('ng-server-context='),
        `GET ${url} did not return the prerendered ${locale} page. The static file exists, ` +
          `so the server is not matching the route to the right locale's build.`
      );
    }

    // The URL the application used to live at, now owned by nothing. Asserted rather than
    // left implicit: a deployment that keeps sending traffic to `/login` gets a 404, and
    // finding that out from this gate is cheaper than finding it out from a redirect rule
    // someone forgot to add. See docs/i18n.md.
    const unprefixed = await get('/login');
    check(
      unprefixed.status === 404,
      `GET /login returned ${unprefixed.status}. With localize on, every route lives under ` +
        `a locale prefix and the bare path belongs to no application — a 200 here means ` +
        `something is serving a locale's build off the root.`
    );

    const localeRoot = await get(LOCALE_ROOT_REDIRECT.from);
    check(
      localeRoot.status === 302,
      `GET ${LOCALE_ROOT_REDIRECT.from} returned ${localeRoot.status}, expected a 302 to ` +
        `the default locale.`
    );
    check(
      (localeRoot.headers.get('location') ?? '').endsWith(LOCALE_ROOT_REDIRECT.to),
      `GET ${LOCALE_ROOT_REDIRECT.from} redirected to ` +
        `"${localeRoot.headers.get('location')}", expected the ${LOCALE_ROOT_REDIRECT.to} ` +
        `base href. That redirect is @angular/ssr's, and it is the only thing standing ` +
        `between a visitor typing the bare domain and a 404.`
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
    const spoofed = await rawGet(port, `/${DEFAULT_LOCALE}/login`, 'evil.example.com');
    check(
      spoofed === 400,
      `GET /${DEFAULT_LOCALE}/login with Host: evil.example.com returned ${spoofed}, ` +
        `expected 400. ` +
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
  checkPriorityImagePreloads();
  await checkRunningServer();
  await checkStartupRefusesWithoutAllowedHosts();

  if (failures.length > 0) {
    for (const failure of failures) console.error(`::error::${failure}`);
    console.error('\nSee docs/ssr.md for what each render mode promises.');
    process.exit(1);
  }

  console.log(
    `assert-ssr: clean (${PRERENDERED_ROUTES.length} prerendered route(s) × ` +
      `${LOCALES.length} locale(s) verified, ${CLIENT_ROUTE.path} served as the shell, ` +
      `incremental hydration live on /${DEFAULT_LOCALE}/login, ` +
      `${PRELOADED_IMAGES.length} priority image(s) preloaded)`
  );
}

await main();
