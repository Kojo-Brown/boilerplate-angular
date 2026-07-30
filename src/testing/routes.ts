import type { Type } from '@angular/core';
import type { Route, Routes } from '@angular/router';

/**
 * Invoke a route's `loadChildren` and return the routes it resolves to.
 *
 * Asserting that `loadChildren` is merely *defined* passes even when the dynamic import
 * points at a moved file or a renamed export — the failure only surfaces at runtime, when
 * a user navigates. Calling the loader is what actually proves the lazy chunk resolves.
 */
export async function loadChildRoutes(route: Route | undefined): Promise<Routes> {
  if (typeof route?.loadChildren !== 'function') {
    throw new Error('Expected the route to declare a loadChildren loader.');
  }
  const loaded: unknown = await route.loadChildren();
  if (!Array.isArray(loaded)) {
    throw new Error('Expected loadChildren to resolve to a Routes array.');
  }
  return loaded as Routes;
}

/** Invoke a route's `loadComponent` and return the component class it resolves to. */
export async function loadRouteComponent(route: Route | undefined): Promise<Type<unknown>> {
  if (typeof route?.loadComponent !== 'function') {
    throw new Error('Expected the route to declare a loadComponent loader.');
  }
  const loaded: unknown = await route.loadComponent();
  if (typeof loaded === 'function') {
    return loaded as Type<unknown>;
  }
  if (typeof loaded === 'object' && loaded !== null && 'default' in loaded) {
    return (loaded as { default: Type<unknown> }).default;
  }
  throw new Error('Expected loadComponent to resolve to a component class.');
}
