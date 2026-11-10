import { NgModule, provideZonelessChangeDetection } from '@angular/core';
import { getTestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';

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

getTestBed().initTestEnvironment(
  [BrowserTestingModule, ZonelessTestingModule],
  platformBrowserTesting(),
  {
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
  }
);
