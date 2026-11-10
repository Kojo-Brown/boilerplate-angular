import { NgModule, provideZonelessChangeDetection } from '@angular/core';
import { getTestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';

/**
 * How long a single spec may take.
 *
 * Stated here and not in `karma.conf.js`, because `client.jasmine` there is not the last
 * word on it. A runner that drives this suite through its own karma configuration
 * **replaces** the whole `client` object rather than merging into it, and the one value in
 * that object which is not a preference then silently reverts to Jasmine's 5s default —
 * halving the budget of all 1248 specs with nothing logged.
 * `@stryker-mutator/karma-runner` does precisely that, which is how this was found; see
 * `docs/mutation-testing.md`.
 *
 * `karma.conf.js` keeps `random: true` and the rest, which are preferences a runner is
 * welcome to override (Stryker needs a deterministic order and sets `random: false`). A
 * timeout is not a preference: it is the line between a slow spec and a failing one.
 *
 * Note for anyone tracing the mutation job's history: raising this to 10s is *not* what
 * fixed `subscribe-web-vitals.spec.ts` under Stryker. That one is excluded from the
 * mutation sandbox and fails there for a different reason, which is written up in
 * `docs/mutation-testing.md` rather than guessed at here.
 */
const SPEC_TIMEOUT_MS = 10_000;

/**
 * Test entry point. Its only job is to make every spec run zoneless.
 *
 * Without a `main` in `angular.json`, the Karma builder synthesises one that reads
 * `window.Zone` and, when it finds it, adds `provideZoneChangeDetection()` to the
 * testing platform. `zone.js/testing` is still in the test polyfills — `fakeAsync()`
 * throws without it — so that default would have quietly kept the whole suite on
 * zone-driven change detection while production ran zoneless: the one configuration
 * where a green suite proves nothing about the app that ships.
 *
 * Providing `provideZonelessChangeDetection()` at the platform level instead means
 * the scheduler under test is the scheduler in `app.config.ts`, for every spec, with
 * no per-file opt-in to forget. ZoneJS is still loaded here, but only as a source of
 * virtual timers for `fakeAsync`/`tick`; Angular no longer schedules off it.
 *
 * The two `errorOnUnknown*` flags mirror the builder's defaults so replacing the
 * generated entry does not silently relax template checking.
 */
@NgModule({ providers: [provideZonelessChangeDetection()] })
export class ZonelessTestingModule {}

jasmine.getEnv().configure({ defaultTimeoutInterval: SPEC_TIMEOUT_MS });

getTestBed().initTestEnvironment(
  [BrowserTestingModule, ZonelessTestingModule],
  platformBrowserTesting(),
  {
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
  }
);
