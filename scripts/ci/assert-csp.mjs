#!/usr/bin/env node
// Fail when the Content-Security-Policy has stopped being a per-response nonce policy.
//
// This gate runs the built server and reads what it answers, for the same reason
// `assert-ssr.mjs` does: every way a nonce deployment fails is invisible in the artifact
// and invisible in a browser.
//
// That last part is the whole argument for this file. A nonce has exactly one security
// property — the attacker cannot predict it — and **every way of losing that property
// leaves a working application**. A nonce baked into `index.html` works. A nonce reused
// across every response works. A nonce served with an `ETag` so the browser keeps
// replaying its cached copy works, and was measured doing exactly that on this
// repository: three loads of `/login`, one nonce, no violation reported, the page
// correct every time. There is no console error to notice, no failed request, no visual
// defect, and axe has nothing to say. The policy and the document agree; they just agree
// on a constant.
//
// So the assertions below are mostly about *difference between two responses*, which is
// the one thing a single request can never show.
//
// ## What it checks
//
//   1. `src/index.html` and `CSP_NONCE_PLACEHOLDER` still agree. The placeholder is a
//      literal in a template that cannot import the constant, so it is the one piece of
//      this mechanism held together by hand.
//   2. Every HTML response carries a policy, and the policy carries a nonce.
//   3. Two requests to the same URL get different nonces. Rule 2 passes for a static
//      nonce; this is the rule that does not.
//   4. The nonce in the header is the nonce in the body, and the placeholder is gone from
//      both. A header and a document that disagree block the application outright, which
//      is the one loud failure in this list.
//   5. Every inline `<script>` that a browser would execute carries the nonce. This is
//      what notices a future Angular emitting an inline script that `addNonce` does not
//      reach — which costs event replay and nothing else, so nothing else would notice.
//      `type="application/json"` data blocks are exempt and asserted to be exempt.
//   6. No inline event-handler attribute survives anywhere in the document. An `onload=`
//      cannot be nonced, so one in the markup means something is permanently blocked —
//      this is what the critical-CSS inliner emits when it cannot find `ngCspNonce`.
//   7. The nonced document is not cacheable: no `ETag`, no `Last-Modified`, and a
//      `Cache-Control` that keeps it out of a shared cache. Rule 3 is what the browser
//      sees; this is what a CDN in front of it sees.
//   8. The policy says no to the things it exists to say no to: `'unsafe-inline'` and
//      `'unsafe-eval'` in `script-src`, and the `angular#unsafe-bypass` Trusted Types
//      policy that `DomSanitizer.bypassSecurityTrust*` needs.
//   9. Subresources are left alone — a hashed chunk keeps its `ETag` and its long
//      `max-age`. Nonce-ing documents must not have made the whole site uncacheable.
//
// Usage: node scripts/ci/assert-csp.mjs [dist-dir]
//        (default: dist/boilerplate-angular, matching `outputPath` in angular.json)

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const distDir = resolve(repoRoot, process.argv[2] ?? 'dist/boilerplate-angular');

/**
 * The documents to probe, one of each kind the server produces.
 *
 * A prerendered route and the client-rendered shell are different code paths through
 * `nonceDocument` in `src/server.ts` — the first is a file on disk with an `ETag`, the
 * second is generated — and only the first carries the event-replay script. Both locales
 * because `localize` doubles the build and each locale has its own prerendered output.
 */
const DOCUMENTS = [
  { url: '/en-US/login', kind: 'prerendered' },
  { url: '/ar/login', kind: 'prerendered' },
  { url: '/en-US/dashboard', kind: 'client-rendered shell' },
];

/** A subresource, to prove rule 9: documents got slower to cache, nothing else did. */
const SUBRESOURCE_DIRECTORY = join(distDir, 'browser', 'en-US');

const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
  return condition;
}

// ---------------------------------------------------------------------------
// 1. The placeholder is written twice and must stay written the same way twice.
// ---------------------------------------------------------------------------

/** The value of `CSP_NONCE_PLACEHOLDER`, read out of its own source. */
function placeholderFromSource() {
  const source = readFileSync(join(repoRoot, 'src/app/core/security/nonce.ts'), 'utf8');
  return source.match(/export const CSP_NONCE_PLACEHOLDER = '([^']+)'/)?.[1] ?? null;
}

function checkPlaceholderAgreement() {
  const placeholder = placeholderFromSource();
  if (
    !check(
      placeholder !== null,
      `could not find CSP_NONCE_PLACEHOLDER in src/app/core/security/nonce.ts. This gate ` +
        `reads it out of the source because src/index.html cannot import it; if the ` +
        `declaration moved, update this regex.`
    )
  ) {
    return null;
  }

  const indexHtml = readFileSync(join(repoRoot, 'src/index.html'), 'utf8');
  const inTemplate = indexHtml.match(/ngCspNonce="([^"]*)"/i)?.[1] ?? null;

  check(
    inTemplate !== null,
    `src/index.html has no ngCspNonce attribute. Without it the critical-CSS inliner ` +
      `leaves the stylesheet's onload="this.media='all'" in place — an inline event ` +
      `handler no nonce can authorise — and the application's own policy blocks its own ` +
      `stylesheet. See src/app/core/security/nonce.ts.`
  );
  check(
    inTemplate === null || inTemplate === placeholder,
    `src/index.html declares ngCspNonce="${inTemplate}" but CSP_NONCE_PLACEHOLDER is ` +
      `"${placeholder}". src/server.ts substitutes the constant, so a drifted literal ` +
      `means the attribute is served verbatim to every visitor and Angular's browser ` +
      `runtime nonces its injected styles with a value the policy does not list.`
  );

  return placeholder;
}

// ---------------------------------------------------------------------------
// The server, running.
// ---------------------------------------------------------------------------

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

function startServer(port) {
  const child = spawn(process.execPath, [join(distDir, 'server', 'server.mjs')], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port), NG_ALLOWED_HOSTS: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  return { child, readOutput: () => output };
}

async function waitForServer(port, child, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    try {
      await fetch(`http://127.0.0.1:${port}/en-US/login`, { headers: { host: '127.0.0.1' } });
      return true;
    } catch {
      await new Promise((done) => setTimeout(done, 250));
    }
  }
  return false;
}

/** Every directive in a policy header, as a map of name to source list. */
function parsePolicy(header) {
  return new Map(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...values] = part.split(/\s+/);
        return [name, values];
      })
  );
}

/** The nonce a policy authorises, from its `script-src`. */
function nonceOf(policy) {
  const source = (policy.get('script-src') ?? []).find((value) => value.startsWith("'nonce-"));
  return source ? source.slice("'nonce-".length, -1) : null;
}

/**
 * The nonce on the document's root element, however the build spelled the attribute.
 *
 * `src/index.html` writes `ngCspNonce` and the builder's HTML rewriter emits
 * `ngcspnonce`: attribute names are case-insensitive in HTML, so the rewriter normalises
 * them. Nothing is wrong with that — Angular's own lookups are case-insensitive too, by
 * the same rule, which is why `@angular/ssr` queries `[ngCspNonce], [ngcspnonce]` — but a
 * gate matching the source spelling fails against a correct build, which is how this
 * function came to exist.
 */
function rootNonce(html) {
  return html.match(/\bngcspnonce="([^"]*)"/i)?.[1] ?? null;
}

/**
 * Every inline `<script>` start tag in a document, with its attributes.
 *
 * Inline means "no `src`": a `<script src>` is a subresource governed by the host
 * sources, and whether it carries a nonce is beside the point.
 */
function inlineScriptTags(html) {
  return [...html.matchAll(/<script\b([^>]*)>/gi)]
    .map((match) => match[1])
    .filter((attrs) => !/\bsrc=/i.test(attrs));
}

/** Whether a `<script>`'s `type` means the browser will execute it. */
function isExecutable(attrs) {
  const type = attrs.match(/\btype="([^"]*)"/i)?.[1]?.toLowerCase().split(';')[0].trim();
  return type === undefined || type === '' || type === 'module' || type === 'text/javascript';
}

async function checkRunningServer(placeholder) {
  const port = await freePort();
  const { child, readOutput } = startServer(port);

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

    for (const { url, kind } of DOCUMENTS) {
      await checkDocument(get, url, kind, placeholder);
    }

    await checkSubresourceStillCacheable(get);
  } finally {
    child.kill('SIGTERM');
  }
}

async function checkDocument(get, url, kind, placeholder) {
  const first = await get(url);
  if (!check(first.status === 200, `GET ${url} returned ${first.status}, expected 200.`)) return;

  const header = first.headers.get('content-security-policy');
  if (
    !check(
      header !== null,
      `GET ${url} (${kind}) carries no Content-Security-Policy header. Every document this ` +
        `server renders is nonced in its markup, so a response without the header is a ` +
        `page whose nonces authorise nothing — see nonceDocument() in src/server.ts.`
    )
  ) {
    return;
  }

  const policy = parsePolicy(header);
  const nonce = nonceOf(policy);
  const html = await first.text();

  // Rule 2.
  if (
    !check(
      nonce !== null && nonce !== '',
      `GET ${url} has a policy with no nonce in script-src: ${header}`
    )
  ) {
    return;
  }

  // Rule 4.
  check(
    !html.includes(placeholder),
    `GET ${url} still contains the build-time placeholder ${placeholder}. The substitution ` +
      `in src/server.ts did not run for this response, so this document's nonce is the same ` +
      `constant for every visitor — which is 'unsafe-inline' with extra steps, and reads as ` +
      `a nonce deployment to anyone auditing the header.`
  );
  check(
    !header.includes(placeholder),
    `GET ${url} serves a policy containing the placeholder: ${header}`
  );
  check(
    rootNonce(html) === nonce,
    `GET ${url} carries ngCspNonce="${rootNonce(html)}" on its root element but a policy ` +
      `authorising "${nonce}". Angular's browser runtime reads that attribute to nonce the ` +
      `<style> elements it injects as lazy components arrive, so they would all be blocked.`
  );

  // Rule 5.
  for (const attrs of inlineScriptTags(html)) {
    if (!isExecutable(attrs)) {
      check(
        !/\bnonce=/i.test(attrs),
        `GET ${url} has a non-executable inline script carrying a nonce (<script${attrs}>). ` +
          `Harmless, but it means something is nonce-ing by search rather than by ` +
          `substitution — see applyCspNonce in src/app/core/security/nonce.ts.`
      );
      continue;
    }
    check(
      attrs.includes(`nonce="${nonce}"`),
      `GET ${url} has an executable inline script with no nonce, or the wrong one: ` +
        `<script${attrs}>. A nonce-based policy blocks it. If this is a script Angular ` +
        `started emitting, find out what it does before nonce-ing it: the builder's ` +
        `addNonce pass covers everything this application knows about, so a new one here ` +
        `is a change in the framework, not a gap in src/server.ts.`
    );
  }

  // Rule 6.
  const handler = html.match(/\son[a-z]+="[^"]*"/i);
  check(
    handler === null,
    `GET ${url} contains the inline event handler${handler ? ` ${handler[0].trim()}` : ''}. ` +
      `An attribute cannot carry a nonce, so this is permanently blocked by the policy. ` +
      `The usual source is the critical-CSS inliner's onload="this.media='all'", which it ` +
      `only rewrites when it can find ngCspNonce in index.html at build time.`
  );

  // Rule 7.
  check(
    first.headers.get('etag') === null && first.headers.get('last-modified') === null,
    `GET ${url} carries a validator (etag: ${first.headers.get('etag')}, last-modified: ` +
      `${first.headers.get('last-modified')}). The validator is computed from the ` +
      `prerendered file and does not change when the nonce does, so a cache will answer ` +
      `later requests from a copy carrying an older nonce — measured as one nonce across ` +
      `three loads, with the page working and nothing logged.`
  );
  const cacheControl = first.headers.get('cache-control') ?? '';
  check(
    /\bno-cache\b|\bno-store\b/.test(cacheControl),
    `GET ${url} has cache-control "${cacheControl}", which lets a cache reuse this ` +
      `document — and its nonce — for a later request.`
  );
  check(
    /\bprivate\b|\bno-store\b/.test(cacheControl),
    `GET ${url} has cache-control "${cacheControl}", which does not keep it out of a ` +
      `*shared* cache. A CDN in front of this server would hand one visitor's nonce to ` +
      `every visitor, which is the failure the per-response nonce exists to prevent.`
  );

  // Rule 8.
  const scriptSrc = policy.get('script-src') ?? [];
  check(
    !scriptSrc.includes("'unsafe-inline'"),
    `GET ${url} allows 'unsafe-inline' in script-src, which is what the nonce replaces.`
  );
  check(
    !scriptSrc.includes("'unsafe-eval'"),
    `GET ${url} allows 'unsafe-eval' in script-src. Nothing in this application needs it, ` +
      `development included — see the header of src/app/core/security/csp.ts.`
  );
  const trustedTypes = policy.get('trusted-types') ?? [];
  check(
    trustedTypes.length > 0 && !trustedTypes.includes('angular#unsafe-bypass'),
    `GET ${url} has trusted-types "${trustedTypes.join(' ')}". Allowing ` +
      `angular#unsafe-bypass restores DomSanitizer.bypassSecurityTrust* at runtime, which ` +
      `is the half of the sanitisation policy that works where ESLint does not run.`
  );
  check(
    (policy.get('require-trusted-types-for') ?? []).includes("'script'"),
    `GET ${url} does not require Trusted Types for script sinks, so the trusted-types ` +
      `allow-list above has no effect.`
  );

  // Rule 3 — the one a single response cannot show.
  const second = await get(url);
  const secondNonce = nonceOf(parsePolicy(second.headers.get('content-security-policy') ?? ''));
  check(
    secondNonce !== null && secondNonce !== nonce,
    `GET ${url} served the same nonce twice (${nonce}). A nonce an attacker can read off ` +
      `an earlier response is not a nonce: their injected <script nonce="${nonce}"> is ` +
      `authorised by the same policy. Every other assertion in this file passes in that ` +
      `state, which is why this one exists.`
  );

  const secondHtml = await second.text();
  check(
    secondNonce === null || rootNonce(secondHtml) === secondNonce,
    `GET ${url} served a second response whose body and header disagree about the nonce.`
  );

  // The conditional request a browser makes on a reload. It must not be answered with a
  // 304, because the body the browser has carries the previous nonce.
  const conditional = await get(url, { 'if-none-match': '"anything"' });
  check(
    conditional.status === 200,
    `GET ${url} with If-None-Match returned ${conditional.status}. A 304 has no body, so ` +
      `the browser reuses its cached copy and the nonce stops being per-response — see ` +
      `the request-validator handling in src/server.ts.`
  );
}

/**
 * Rule 9: the hashed subresources are still cacheable.
 *
 * `express.static` serves them with `maxAge: '1y'` and that is safe because their names
 * carry a content hash. Making documents uncacheable must not have reached them: the
 * obvious wrong fix for the nonce problem is a blanket no-store, which would re-download
 * the whole bundle on every navigation and show up as nothing but a slower application.
 */
async function checkSubresourceStillCacheable(get) {
  const { readdirSync } = await import('node:fs');
  if (!existsSync(SUBRESOURCE_DIRECTORY)) {
    failures.push(`${SUBRESOURCE_DIRECTORY} is missing — did the build run?`);
    return;
  }
  const chunk = readdirSync(SUBRESOURCE_DIRECTORY).find((name) => /^main-.*\.js$/.test(name));
  if (!check(chunk !== undefined, `no hashed main-*.js in ${SUBRESOURCE_DIRECTORY}.`)) return;

  const response = await get(`/en-US/${chunk}`);
  if (!check(response.status === 200, `GET /en-US/${chunk} returned ${response.status}.`)) return;

  const cacheControl = response.headers.get('cache-control') ?? '';
  check(
    /max-age=\d{5,}/.test(cacheControl),
    `GET /en-US/${chunk} has cache-control "${cacheControl}", but a content-hashed chunk ` +
      `should still be cacheable for a long time. Only documents carry a nonce.`
  );
  check(
    !response.headers.get('content-security-policy'),
    `GET /en-US/${chunk} carries a Content-Security-Policy header. A policy on a script ` +
      `governs nothing and only costs bytes on every request.`
  );
}

// ---------------------------------------------------------------------------

const placeholder = checkPlaceholderAgreement();
if (placeholder !== null) {
  await checkRunningServer(placeholder);
}

if (failures.length > 0) {
  console.error(`\nassert-csp.mjs: ${failures.length} problem(s)\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}\n`);
  process.exit(1);
}

console.log(
  `assert-csp.mjs: clean — ${DOCUMENTS.length} documents, each with a fresh nonce, no ` +
    `validator, no un-nonced executable inline script, and no inline event handler.`
);
