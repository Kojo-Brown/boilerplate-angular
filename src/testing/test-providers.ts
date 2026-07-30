import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import type { EnvironmentProviders, Provider } from '@angular/core';
import { AuthStore } from '@/app/store/auth/auth.store';
import { createMockAuthStore } from './mock-factories';

/**
 * `provideHttpClient()` and friends return `EnvironmentProviders`, not `Provider`.
 * `TestBed.configureTestingModule({ providers })` accepts either, so the array type
 * has to admit both — the same union Angular uses for `ApplicationConfig.providers`.
 */
type TestProvider = Provider | EnvironmentProviders;

/** Standard providers for components that need routing + HTTP + auth. */
export function provideTestDeps(extraProviders: TestProvider[] = []): TestProvider[] {
  return [
    provideHttpClient(),
    provideHttpClientTesting(),
    provideRouter([]),
    { provide: AuthStore, useValue: createMockAuthStore() },
    ...extraProviders,
  ];
}

/** Providers for tests that need HTTP but not auth. */
export function provideHttpTestDeps(): TestProvider[] {
  return [provideHttpClient(), provideHttpClientTesting()];
}
