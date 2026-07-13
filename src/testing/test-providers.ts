import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import type { Provider } from '@angular/core';
import { AuthStore } from '@/app/store/auth/auth.store';
import { createMockAuthStore } from './mock-factories';

/** Standard providers for components that need routing + HTTP + auth. */
export function provideTestDeps(extraProviders: Provider[] = []): Provider[] {
  return [
    provideHttpClient(),
    provideHttpClientTesting(),
    provideRouter([]),
    { provide: AuthStore, useValue: createMockAuthStore() },
    ...extraProviders,
  ];
}

/** Providers for tests that need HTTP but not auth. */
export function provideHttpTestDeps(): Provider[] {
  return [provideHttpClient(), provideHttpClientTesting()];
}
