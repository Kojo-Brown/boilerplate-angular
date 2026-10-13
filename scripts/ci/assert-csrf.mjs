#!/usr/bin/env node
// Fail when the CSRF contract has drifted apart from itself.
//
// ## Why this is a gate and not a test
//
// `csrf.interceptor.spec.ts` proves what the interceptor sends, and `e2e/csrf/csrf.spec.ts`
// proves a real browser satisfies a real implementation of the server's rules. Between
// them they cover the behaviour. What neither can cover is *agreement between the pieces*,
// because each half of a disagreement is internally consistent and passes its own tests:
//
//   1. **A second definition of either name.** The cookie name is handed to
//      `withXsrfConfiguration`, which is what Angular's extractor reads; the header name is
//      written by `csrfInterceptor`; the server's half, the mocks and `docs/csrf.md` all
//      quote both. Six readers, and a repository where one of them had grown its own
//      literal would pass every test — the interceptor would attach a header consistently,
//      the mock would check for it consistently, and they would be different headers. The
//      rule is therefore lexical: the two strings may appear in exactly one file.
//
//   2. **The scoping being dropped.** `csrfInterceptor` is installed inside
//      `interceptWhen(requestsUnder(environment.apiUrl), …)`, and that is a security
//      property rather than a tidiness measure: a CSRF token sent to an arbitrary origin is
//      a token handed to whoever is on the other end, which is exactly why Angular's own
//      interceptor refuses cross-origin requests. Hoisting it out of that scope would make
//      every spec in this repository pass — they only ever exercise the configured API —
//      while leaking the token to every third-party host the application ever posts to.
//
//   3. **`withNoXsrfProtection()`.** One call, anywhere, and `HttpXsrfTokenExtractor`
//      returns `null` for the rest of the application's life. Every mutation then goes out
//      without a header, because `csrfInterceptor` is built not to block — so nothing
//      fails here, and the first sign of it is a 403 in production.
//
//   4. **The document drifting from the code.** `docs/csrf.md` is the contract an API
//      author implements from. A cookie name in it that no longer matches the one the
//      application reads is worse than no document: it is a specification that produces a
//      correctly built, non-functioning API. So the fenced HTTP blocks are parsed and the
//      names in them are compared against the constants, rather than being trusted to have
//      been updated alongside.
//
// Usage:  node scripts/ci/assert-csrf.mjs
// See:    docs/csrf.md

import { appendFileSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { repoRoot } from './lib/templates.mjs';

/** The one file allowed to define the contract's names. Every other reader imports it. */
const CONTRACT_FILE = 'src/app/core/http/csrf.ts';

/**
 * The one file allowed to *quote* them, and why.
 *
 * `csrf.spec.ts` exists to pin the two values, which it can only do by writing them out —
 * a spec that asserted `CSRF_CONTRACT.cookieName === CSRF_CONTRACT.cookieName` would pass
 * whatever either side said. It is the same exemption `assert-no-token-persistence.mjs`
 * grants `document-cookies.ts`, and it is bounded the same way: one path, exact, with a
 * self-test below that the allow-list has not quietly widened.
 */
const LITERAL_ALLOWED = new Set(['src/app/core/http/csrf.spec.ts']);

/** Where the interceptor is installed, and where the scoping has to be visible. */
const APP_CONFIG_FILE = 'src/app/app.config.ts';

/** The contract document, parsed rather than trusted. */
const CONTRACT_DOC = 'docs/csrf.md';

/**
 * Reads the two names out of the contract file, so this gate has no copy of its own.
 *
 * A gate carrying its own literals would be a seventh reader to drift, and the one nobody
 * would think to check.
 */
function readContract(source) {
  const cookie = /cookieName:\s*'([^']+)'/.exec(source);
  const header = /headerName:\s*'([^']+)'/.exec(source);

  if (!cookie || !header) {
    throw new Error(
      `assert-csrf: could not read cookieName/headerName from ${CONTRACT_FILE}. ` +
        'If CSRF_CONTRACT has been restructured, this gate needs restructuring with it.'
    );
  }

  return { cookieName: cookie[1], headerName: header[1] };
}

/**
 * Flags a literal occurrence of either name outside the contract file.
 *
 * Comments are stripped first: this file's own header, and the long explanations in
 * `csrf.ts`, `csrf.interceptor.ts` and `docs/csrf.md`, all name both strings in prose, and
 * a gate that could not tell prose from code would have to be weakened to stay quiet.
 */
export function auditSource(file, source, contract) {
  if (file === CONTRACT_FILE || LITERAL_ALLOWED.has(file)) return [];

  const failures = [];
  let inBlockComment = false;

  source.split('\n').forEach((raw, index) => {
    const stripped = stripComments(raw, inBlockComment);
    inBlockComment = stripped.inBlockComment;
    const code = stripped.code;
    if (code.trim() === '') return;

    for (const [kind, name] of [
      ['cookie', contract.cookieName],
      ['header', contract.headerName],
    ]) {
      if (!code.includes(`'${name}'`) && !code.includes(`"${name}"`) && !code.includes(`\`${name}\``)) {
        continue;
      }
      failures.push({
        file,
        line: index + 1,
        message:
          `the CSRF ${kind} name is written out here. It is handed to ` +
          `withXsrfConfiguration, written by csrfInterceptor, checked by the server ` +
          `contract and quoted in docs/csrf.md — six readers, and a second literal is a ` +
          `second source of truth that every test would still pass. Import ` +
          `CSRF_CONTRACT from @/app/core/http/csrf instead`,
      });
    }
  });

  return failures;
}

/**
 * Checks the interceptor is installed, and installed inside the API scope.
 *
 * Deliberately lexical and deliberately narrow: it asserts that `csrfInterceptor` appears
 * in the same `interceptWhen(requestsUnder(...), composeInterceptors(...))` call that
 * already scopes caching and retries. A rewrite of that chain should fail this and be
 * looked at, which is the point — the scoping is the bound on where the token may travel.
 */
export function auditInstallation(source) {
  const failures = [];
  const code = stripAllComments(source);

  if (!code.includes('csrfInterceptor')) {
    failures.push({
      message:
        'csrfInterceptor is not installed. Every mutating request to the API then goes ' +
        'out with no CSRF token: nothing fails here, nothing warns, and the first sign ' +
        'is a 403 from a correctly configured API. See docs/csrf.md',
    });
    return failures;
  }

  const scoped = /interceptWhen\(\s*requestsUnder\(\s*environment\.apiUrl\s*\)\s*,\s*composeInterceptors\(([^)]*)\)/.exec(
    code
  );

  if (!scoped) {
    failures.push({
      message:
        'the interceptWhen(requestsUnder(environment.apiUrl), composeInterceptors(…)) ' +
        'call could not be found, so this gate cannot tell whether csrfInterceptor is ' +
        'still scoped to the configured API',
    });
    return failures;
  }

  if (!scoped[1].includes('csrfInterceptor')) {
    failures.push({
      message:
        'csrfInterceptor is installed outside the requestsUnder(environment.apiUrl) ' +
        'scope. A CSRF token sent to an arbitrary origin is a token handed to whoever ' +
        'is on the other end — which is precisely why Angular’s built-in interceptor ' +
        'refuses cross-origin requests. Every test in this repository would still pass, ' +
        'because none of them posts to a third-party host',
    });
  }

  if (!code.includes('withXsrfConfiguration')) {
    failures.push({
      message:
        'withXsrfConfiguration is not configured, so HttpXsrfTokenExtractor is no longer ' +
        'pointed at the contract’s cookie by this application’s own configuration',
    });
  }

  return failures;
}

/** `withNoXsrfProtection()` anywhere makes the extractor return null for good. */
export function auditDisabling(file, source) {
  const code = stripAllComments(source);
  if (!code.includes('withNoXsrfProtection')) return [];

  return [
    {
      file,
      line: source.split('\n').findIndex((line) => line.includes('withNoXsrfProtection')) + 1,
      message:
        'withNoXsrfProtection() makes HttpXsrfTokenExtractor return null everywhere, so ' +
        'every mutation goes out with no token. csrfInterceptor does not block on a ' +
        'missing token — by design, see docs/csrf.md — so nothing here fails and the ' +
        'first symptom is a 403 in production',
    },
  ];
}

/**
 * Compares the names in the document's fenced HTTP blocks against the constants.
 *
 * Only the fenced blocks, and only header/cookie lines in them: the prose discusses both
 * names at length and should be free to. What is checked is the part an API author copies.
 */
export function auditDocument(source, contract) {
  const failures = [];
  const blocks = [...source.matchAll(/```(?:http|js)?\n([\s\S]*?)```/g)].map((match) => match[1]);

  if (blocks.length === 0) {
    return [{ message: `${CONTRACT_DOC} has no fenced HTTP examples to check.` }];
  }

  const text = blocks.join('\n');

  // The document must show both halves of the double submit, spelled as the code spells
  // them. A `Set-Cookie` for the wrong name is a specification for an API that builds
  // correctly and does not work.
  if (!new RegExp(`Set-Cookie:\\s*${escapeRegExp(contract.cookieName)}=`).test(text)) {
    failures.push({
      message:
        `${CONTRACT_DOC} never shows the API setting \`${contract.cookieName}\`, which is ` +
        `the cookie HttpXsrfTokenExtractor actually reads. An API built from this ` +
        `document would set the wrong one and fail every mutation`,
    });
  }

  if (!new RegExp(`^\\s*${escapeRegExp(contract.headerName)}:`, 'm').test(text)) {
    failures.push({
      message:
        `${CONTRACT_DOC} never shows a request carrying \`${contract.headerName}\`, which ` +
        `is the header csrfInterceptor writes`,
    });
  }

  // A custom header on a cross-origin request is only sent if the preflight permits it,
  // and a missing entry here fails every mutation in the browser as a CORS error with
  // nothing in the API's logs. It is the requirement most easily left out of a document.
  if (!new RegExp(`Access-Control-Allow-Headers:.*${escapeRegExp(contract.headerName)}`).test(text)) {
    failures.push({
      message:
        `${CONTRACT_DOC} does not require \`${contract.headerName}\` in ` +
        `Access-Control-Allow-Headers. Without it the browser's preflight refuses the ` +
        `request before the API sees it — a CORS error, not a 403, with nothing logged`,
    });
  }

  // "At least one correct occurrence" is not enough, and the first draft of this rule
  // only checked that: the document sets the cookie in four places — the session
  // response, the bootstrap, the expiry on logout — so drifting *one* of them left the
  // others matching and the gate quiet. A partially drifted document is the worse
  // artifact of the two, because it reads as internally consistent. So every CSRF-shaped
  // cookie named anywhere in the examples has to be spelled exactly as the code spells
  // it.
  const csrfish = /^\s*Set-Cookie:\s*((?:X-)?(?:CSRF|XSRF)[-_]?TOKEN)\s*=/gim;
  for (const match of text.matchAll(csrfish)) {
    if (match[1] === contract.cookieName) continue;
    failures.push({
      message:
        `${CONTRACT_DOC} sets a cookie named \`${match[1]}\`, but the application reads ` +
        `\`${contract.cookieName}\`. An API built from this document would set a cookie ` +
        `nothing reads, and every mutation would go out with no token`,
    });
  }

  // The one attribute that must *not* be there. `HttpOnly` on this cookie means the
  // extractor reads null and the whole scheme degrades to sending nothing.
  const cookieLines = text
    .split('\n')
    .filter((line) => line.includes(`${contract.cookieName}=`) && /set-cookie/i.test(line));
  for (const line of cookieLines) {
    if (/HttpOnly/i.test(line)) {
      failures.push({
        message:
          `${CONTRACT_DOC} shows \`${contract.cookieName}\` set HttpOnly: ` +
          `${line.trim()}. That is the refresh cookie's attribute, and on this one it ` +
          `means JavaScript cannot read the token and every mutation goes out bare`,
      });
    }
  }

  return failures;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Removes `//` and `/* *​/` comment text from one line, tracking block state. */
function stripComments(line, inBlockComment) {
  let code = '';
  let index = 0;
  let inBlock = inBlockComment;

  while (index < line.length) {
    if (inBlock) {
      const end = line.indexOf('*/', index);
      if (end === -1) return { code, inBlockComment: true };
      inBlock = false;
      index = end + 2;
      continue;
    }

    const lineComment = line.indexOf('//', index);
    const blockStart = line.indexOf('/*', index);

    if (lineComment !== -1 && (blockStart === -1 || lineComment < blockStart)) {
      code += line.slice(index, lineComment);
      return { code, inBlockComment: false };
    }

    if (blockStart !== -1) {
      code += line.slice(index, blockStart);
      inBlock = true;
      index = blockStart + 2;
      continue;
    }

    code += line.slice(index);
    break;
  }

  return { code, inBlockComment: inBlock };
}

function stripAllComments(source) {
  let inBlockComment = false;
  return source
    .split('\n')
    .map((line) => {
      const stripped = stripComments(line, inBlockComment);
      inBlockComment = stripped.inBlockComment;
      return stripped.code;
    })
    .join('\n');
}

/**
 * The rules, proven against the failures they name before the repository is certified.
 *
 * Same reasoning as the other gates here: a rule that cannot be shown to fail is a rule
 * that might be matching nothing, and the whole value of this file is that it catches a
 * drift no test would.
 */
const SELF_TESTS = [
  () => {
    const contract = { cookieName: 'XSRF-TOKEN', headerName: 'X-XSRF-TOKEN' };
    const found = auditSource('src/app/other.ts', `const name = 'XSRF-TOKEN';`, contract);
    if (found.length !== 1) throw new Error('a duplicated cookie literal is not flagged');
  },
  () => {
    const contract = { cookieName: 'XSRF-TOKEN', headerName: 'X-XSRF-TOKEN' };
    const found = auditSource(
      'src/app/other.ts',
      `// the X-XSRF-TOKEN header is 'X-XSRF-TOKEN'\nconst ok = 1;`,
      contract
    );
    if (found.length !== 0) throw new Error('prose about the names is flagged as code');
  },
  () => {
    const contract = { cookieName: 'XSRF-TOKEN', headerName: 'X-XSRF-TOKEN' };
    if (auditSource(CONTRACT_FILE, `cookieName: 'XSRF-TOKEN',`, contract).length !== 0) {
      throw new Error('the contract file is not exempt from its own rule');
    }
  },
  () => {
    const contract = { cookieName: 'XSRF-TOKEN', headerName: 'X-XSRF-TOKEN' };
    // The allow-list is an exemption for one path, and it has to be exactly one path.
    const [allowed] = [...LITERAL_ALLOWED];
    if (auditSource(allowed, `expect(x).toBe('XSRF-TOKEN');`, contract).length !== 0) {
      throw new Error('the literal allow-list does not apply');
    }
    if (auditSource('src/app/other.spec.ts', `expect(x).toBe('XSRF-TOKEN');`, contract).length !== 1) {
      throw new Error('the literal allow-list is too broad');
    }
  },
  () => {
    const hoisted = `withInterceptors([csrfInterceptor, interceptWhen(requestsUnder(environment.apiUrl), composeInterceptors(cacheInterceptor))]) withXsrfConfiguration(x)`;
    if (auditInstallation(hoisted).length !== 1) {
      throw new Error('an unscoped csrfInterceptor is not flagged');
    }
  },
  () => {
    const absent = `withInterceptors([interceptWhen(requestsUnder(environment.apiUrl), composeInterceptors(cacheInterceptor))])`;
    if (auditInstallation(absent).length !== 1) {
      throw new Error('a missing csrfInterceptor is not flagged');
    }
  },
  () => {
    const good = `withXsrfConfiguration(CSRF_CONTRACT) interceptWhen(requestsUnder(environment.apiUrl), composeInterceptors(csrfInterceptor, cacheInterceptor, retryInterceptor))`;
    if (auditInstallation(good).length !== 0) {
      throw new Error('a correct installation is flagged');
    }
  },
  () => {
    if (auditDisabling('src/app/app.config.ts', 'withNoXsrfProtection()').length !== 1) {
      throw new Error('withNoXsrfProtection is not flagged');
    }
    if (auditDisabling('src/app/app.config.ts', '// never withNoXsrfProtection()').length !== 0) {
      throw new Error('prose about withNoXsrfProtection is flagged');
    }
  },
  () => {
    const contract = { cookieName: 'XSRF-TOKEN', headerName: 'X-XSRF-TOKEN' };
    const drifted = [
      '```http',
      'Set-Cookie: CSRF-TOKEN=abc; Path=/',
      'X-XSRF-TOKEN: abc',
      'Access-Control-Allow-Headers: X-XSRF-TOKEN',
      '```',
    ].join('\n');
    // Two findings: the required name is missing, and a wrong one is present.
    if (auditDocument(drifted, contract).length !== 2) {
      throw new Error('a drifted cookie name in the document is not flagged');
    }
  },
  () => {
    const contract = { cookieName: 'XSRF-TOKEN', headerName: 'X-XSRF-TOKEN' };
    // One of several occurrences drifted: the rule must not be satisfied by the others.
    const partial = [
      '```http',
      'Set-Cookie: XSRF-TOKEN=abc; Path=/',
      'Set-Cookie: CSRF-TOKEN=; Path=/; Max-Age=0',
      'X-XSRF-TOKEN: abc',
      'Access-Control-Allow-Headers: X-XSRF-TOKEN',
      '```',
    ].join('\n');
    if (auditDocument(partial, contract).length !== 1) {
      throw new Error('a partially drifted document is not flagged');
    }
  },
  () => {
    const contract = { cookieName: 'XSRF-TOKEN', headerName: 'X-XSRF-TOKEN' };
    const httpOnly = [
      '```http',
      'Set-Cookie: XSRF-TOKEN=abc; HttpOnly; Path=/',
      'X-XSRF-TOKEN: abc',
      'Access-Control-Allow-Headers: X-XSRF-TOKEN',
      '```',
    ].join('\n');
    if (auditDocument(httpOnly, contract).length !== 1) {
      throw new Error('an HttpOnly CSRF cookie in the document is not flagged');
    }
  },
  () => {
    const contract = { cookieName: 'XSRF-TOKEN', headerName: 'X-XSRF-TOKEN' };
    const noCors = ['```http', 'Set-Cookie: XSRF-TOKEN=abc', 'X-XSRF-TOKEN: abc', '```'].join('\n');
    if (auditDocument(noCors, contract).length !== 1) {
      throw new Error('a missing Access-Control-Allow-Headers entry is not flagged');
    }
  },
];

/** Every `.ts` file that ships or tests, under `src/` and `e2e/`. */
async function auditedFiles() {
  const walkDir = async (dir) => {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return walkDir(path);
        return entry.isFile() && path.endsWith('.ts') ? [path] : [];
      })
    );
    return files.flat();
  };

  const roots = [join(repoRoot, 'src'), join(repoRoot, 'e2e')];
  const found = await Promise.all(roots.map(walkDir));
  return found.flat().sort();
}

async function main() {
  for (const selfTest of SELF_TESTS) selfTest();

  const contractSource = readFileSync(join(repoRoot, CONTRACT_FILE), 'utf8');
  const contract = readContract(contractSource);

  const failures = [];
  let scanned = 0;

  for (const absolute of await auditedFiles()) {
    scanned += 1;
    const file = relative(repoRoot, absolute).split('\\').join('/');
    const source = readFileSync(absolute, 'utf8');
    failures.push(...auditSource(file, source, contract));
    failures.push(...auditDisabling(file, source));
  }

  const appConfig = readFileSync(join(repoRoot, APP_CONFIG_FILE), 'utf8');
  failures.push(
    ...auditInstallation(appConfig).map((failure) => ({ ...failure, file: APP_CONFIG_FILE }))
  );

  const doc = readFileSync(join(repoRoot, CONTRACT_DOC), 'utf8');
  failures.push(...auditDocument(doc, contract).map((failure) => ({ ...failure, file: CONTRACT_DOC })));

  writeSummary(
    `### CSRF contract\n\n` +
      `\`${contract.cookieName}\` / \`${contract.headerName}\`, defined once in ` +
      `\`${CONTRACT_FILE}\`. ${scanned} source file(s) scanned; ` +
      `${failures.length} problem(s) found.\n`
  );

  if (failures.length > 0) {
    for (const failure of failures) {
      const location = failure.line ? `file=${failure.file},line=${failure.line}` : `file=${failure.file}`;
      console.error(`::error ${location}::CSRF — ${failure.message}`);
    }
    console.error('See docs/csrf.md for the contract these rules hold the repository to.');
    process.exit(1);
  }

  console.log(
    `assert-csrf: clean (${scanned} source file(s), ${SELF_TESTS.length} rule self-tests passed)`
  );
}

/** Append to the GitHub Actions job summary when there is one, so the audit lands on the PR. */
function writeSummary(markdown) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  appendFileSync(path, `${markdown}\n`);
}

await main();
