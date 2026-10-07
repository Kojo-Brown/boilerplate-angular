#!/usr/bin/env node
// Fail when shipped source puts an auth token somewhere a later page load can read it.
//
// ## Why this is a gate and not a test
//
// `docs/token-storage.md` makes two claims about this application: the access token
// exists only in memory, and the refresh token is never in JavaScript's hands at all.
// Both are properties of *every* line of source, and a spec can only ever assert them
// about the lines it happens to call. A new feature that writes
// `localStorage.setItem('token', …)` in a component, or a well-meaning "remember me"
// checkbox that persists the access token, breaks the design while every existing test
// stays green: nothing warns, nothing fails, the application works, and the defence
// against a cross-site-scripting bug reading the session is quietly gone.
//
// Nor does the lint rule nearby cover it. `no-restricted-globals` bans the bare
// `localStorage` global in `src/app/**` because it is undefined under server-side
// rendering — so `storageOf(inject(DOCUMENT).defaultView)` and `THEME_PREFERENCE_STORE`
// satisfy it, and both are legitimate. What is banned here is narrower and different:
// not reaching web storage, but putting a *token* in it, through whatever accessor.
//
// ## What is flagged
//
//   1. A write to web storage (`setItem`, index or property assignment) whose key or
//      value mentions a token. The key is matched against known token vocabulary, so
//      `theme` and `sidebar_collapsed` pass and `auth_access_token` does not.
//   2. An assignment to `document.cookie` anywhere in `src/`. This application never
//      sets a cookie: the session cookies are the API's to set, with `HttpOnly` on the
//      one that matters, and a cookie written from JavaScript is by definition one
//      JavaScript can read. The single exception is `deleteCookie` in
//      `core/platform/document-cookies.ts`, which only ever expires a cookie —
//      allow-listed by path, and its own spec covers what it writes.
//
// What is deliberately not flagged: reads. `readCookie` exists to read the session
// hint, which is a non-secret marker, and a gate that banned reading would ban it.
//
// Usage:  node scripts/ci/assert-no-token-persistence.mjs
// See:    docs/token-storage.md

import { appendFileSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { repoRoot } from './lib/templates.mjs';

/**
 * The vocabulary that makes a storage key a token key.
 *
 * Matched case-insensitively against the key *and* the stored expression, so
 * `setItem('auth_access_token', t)`, `setItem(ACCESS_TOKEN_KEY, t)` and
 * `setItem('session', accessToken)` are all caught while `setItem('theme', mode)` is
 * not. `jwt` and `bearer` are here because a token does not have to be called one.
 */
const TOKEN_WORDS = [
  'token',
  'jwt',
  'bearer',
  'credential',
  'accesstoken',
  'refreshtoken',
  'id_token',
];

/**
 * Every way of writing to web storage that reaches a value.
 *
 * `removeItem` and `clear` are absent on purpose: removing a token is the fix, not the
 * fault. `getItem` is absent for the same reason as cookie reads.
 */
const STORAGE_WRITE =
  /\b(?:local|session)Storage\s*(?:\.\s*setItem\s*\(|\[[^\]]*\]\s*=(?!=)|\.\s*[A-Za-z_$][\w$]*\s*=(?!=))/;

/** `doc.cookie = …`, `document.cookie = …`, `this.doc.cookie = …`, `d['cookie'] = …`. */
const COOKIE_WRITE = /\.\s*cookie\s*=(?!=)|\[\s*['"]cookie['"]\s*\]\s*=(?!=)/;

/**
 * The one file allowed to assign `document.cookie`, and why.
 *
 * `deleteCookie` writes an immediate expiry and nothing else — it cannot store a value,
 * because `Max-Age=0` is the whole payload. Expiring the session hint from the client is
 * a legitimate part of signing out; see `AuthStore.clearSession`.
 */
const COOKIE_WRITE_ALLOWED = new Set(['src/app/core/platform/document-cookies.ts']);

function mentionsToken(text) {
  const lowered = text.toLowerCase().replaceAll('_', '');
  return TOKEN_WORDS.some((word) => lowered.includes(word.replaceAll('_', '')));
}

/**
 * Audit one file's source.
 *
 * Line-based rather than AST-based, which is the right trade for this shape of rule: the
 * patterns are lexical (a member name, an assignment target), the file set is small, and
 * a regex cannot be defeated by a type annotation. Comments are stripped first so prose
 * about the ban — of which there is a lot, this header included — does not trip it.
 */
export function auditSource(file, source) {
  const failures = [];
  const lines = source.split('\n');
  let inBlockComment = false;

  lines.forEach((raw, index) => {
    const line = stripComments(raw, inBlockComment);
    inBlockComment = line.inBlockComment;
    const code = line.code;
    if (code.trim() === '') return;

    if (STORAGE_WRITE.test(code) && mentionsToken(code)) {
      failures.push({
        file,
        line: index + 1,
        message:
          'an auth token written to web storage is readable by any script on this origin, ' +
          'including an injected one. Keep the access token in AuthStore state and let the ' +
          'API hold the refresh token in an HttpOnly cookie',
      });
    }

    if (COOKIE_WRITE.test(code) && !COOKIE_WRITE_ALLOWED.has(file)) {
      failures.push({
        file,
        line: index + 1,
        message:
          'this application does not set cookies. The session cookies are the API’s, and the ' +
          'refresh cookie is HttpOnly precisely so that JavaScript cannot write or read it',
      });
    }
  });

  return failures;
}

/**
 * The code on one line, with comments removed.
 *
 * Deliberately simple: it does not understand a `//` inside a string literal, which
 * would mean dropping the rest of a line that is code. The consequence is a missed
 * detection in a contrived case, never a false failure — and a token being persisted
 * from inside a URL-shaped string literal is not the regression this guards against.
 */
function stripComments(raw, startsInBlockComment) {
  let code = '';
  let inBlockComment = startsInBlockComment;

  for (let i = 0; i < raw.length; i += 1) {
    if (inBlockComment) {
      if (raw.startsWith('*/', i)) {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (raw.startsWith('/*', i)) {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (raw.startsWith('//', i)) break;
    code += raw[i];
  }

  return { code, inBlockComment };
}

/**
 * The rules, checked against what they are supposed to catch and to let through, before
 * the repository is certified. A gate nobody has seen fail is a gate nobody has tested.
 */
const SELF_TESTS = [
  // Caught.
  { source: `localStorage.setItem('auth_access_token', t);`, expect: 1 },
  { source: `localStorage.setItem(ACCESS_TOKEN_KEY, t);`, expect: 1 },
  { source: `sessionStorage.setItem('refresh_token', t);`, expect: 1 },
  { source: `localStorage.setItem('session', accessToken);`, expect: 1 },
  { source: `localStorage['jwt'] = t;`, expect: 1 },
  { source: `localStorage.idToken = t;`, expect: 1 },
  { source: `window.localStorage.setItem('bearer', t);`, expect: 1 },
  { source: `doc.cookie = 'refresh_token=' + t;`, expect: 1 },
  { source: `document.cookie = \`session=\${t}\`;`, expect: 1 },
  { source: `d['cookie'] = 'a=b';`, expect: 1 },
  // Let through: not a token, not a write, or prose about the ban.
  { source: `localStorage.setItem('theme', mode);`, expect: 0 },
  { source: `storage.setItem(THEME_KEY, preference);`, expect: 0 },
  { source: `localStorage.removeItem('auth_access_token');`, expect: 0 },
  { source: `const t = localStorage.getItem('auth_access_token');`, expect: 0 },
  { source: `const jar = doc.cookie;`, expect: 0 },
  { source: `if (document.cookie === '') return null;`, expect: 0 },
  { source: `// never write a token to localStorage.setItem('jwt', t)`, expect: 0 },
  { source: `/* doc.cookie = 'refresh_token=x' is banned */`, expect: 0 },
  { source: `/**\n * localStorage.setItem('access_token', t) is what this bans.\n */`, expect: 0 },
];

function selfTest() {
  for (const { source, expect } of SELF_TESTS) {
    const found = auditSource('self-test.ts', source);
    if (found.length !== expect) {
      throw new Error(
        `assert-no-token-persistence self-test: ${JSON.stringify(source)} expected ` +
          `${expect} finding(s), got ${found.length} ${JSON.stringify(found)}.`
      );
    }
  }

  // The allow-list is an exemption for one path, and it has to be exactly one path.
  const [allowed] = [...COOKIE_WRITE_ALLOWED];
  if (auditSource(allowed, `doc.cookie = 'x=; Max-Age=0';`).length !== 0) {
    throw new Error('assert-no-token-persistence self-test: the allow-list does not apply.');
  }
  if (auditSource('src/app/other.ts', `doc.cookie = 'x=; Max-Age=0';`).length !== 1) {
    throw new Error('assert-no-token-persistence self-test: the allow-list is too broad.');
  }
}

/** Every `.ts` file under `src/` that ships. Specs are excluded: they assert the ban. */
async function shippedFiles() {
  const walkDir = async (dir) => {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return walkDir(path);
        const shipped = path.endsWith('.ts') && !path.endsWith('.spec.ts');
        return entry.isFile() && shipped ? [path] : [];
      })
    );
    return files.flat();
  };

  return (await walkDir(join(repoRoot, 'src'))).sort();
}

async function main() {
  selfTest();

  const failures = [];
  let scanned = 0;
  for (const absolute of await shippedFiles()) {
    scanned += 1;
    const file = relative(repoRoot, absolute).split('\\').join('/');
    failures.push(...auditSource(file, readFileSync(absolute, 'utf8')));
  }

  writeSummary(
    `### Token persistence\n\n` +
      `${scanned} shipped source file(s) scanned; ${failures.length} persisted token(s) found.\n`
  );

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`::error file=${failure.file},line=${failure.line}::Token storage — ${failure.message}`);
    }
    console.error('See docs/token-storage.md for where a token is allowed to live.');
    process.exit(1);
  }

  console.log(
    `assert-no-token-persistence: clean (${scanned} source file(s), ` +
      `${SELF_TESTS.length} rule self-tests passed)`
  );
}

/** Append to the GitHub Actions job summary when there is one, so the audit lands on the PR. */
function writeSummary(markdown) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  appendFileSync(path, `${markdown}\n`);
}

await main();
