import { Component } from '@angular/core';
import type { Route } from '@angular/router';
import { loadChildRoutes, loadRouteComponent } from './routes';

@Component({ standalone: true, template: '' })
class StubComponent {}

describe('loadChildRoutes', () => {
  it('resolves the routes a loadChildren loader returns', async () => {
    const children: Route[] = [{ path: 'a' }];
    const route: Route = { path: '', loadChildren: () => Promise.resolve(children) };
    await expectAsync(loadChildRoutes(route)).toBeResolvedTo(children);
  });

  it('rejects when the route has no loadChildren loader', async () => {
    await expectAsync(loadChildRoutes({ path: '' })).toBeRejectedWithError(
      /declare a loadChildren loader/
    );
  });

  it('rejects when the route is undefined', async () => {
    await expectAsync(loadChildRoutes(undefined)).toBeRejectedWithError(
      /declare a loadChildren loader/
    );
  });

  it('rejects when the loader resolves to something that is not a Routes array', async () => {
    const route = { path: '', loadChildren: () => Promise.resolve(StubComponent) } as Route;
    await expectAsync(loadChildRoutes(route)).toBeRejectedWithError(/resolve to a Routes array/);
  });
});

describe('loadRouteComponent', () => {
  it('resolves the component a loadComponent loader returns', async () => {
    const route: Route = { path: '', loadComponent: () => Promise.resolve(StubComponent) };
    await expectAsync(loadRouteComponent(route)).toBeResolvedTo(StubComponent);
  });

  it('unwraps a module that exports the component as a default export', async () => {
    const route: Route = {
      path: '',
      loadComponent: () => Promise.resolve({ default: StubComponent }),
    };
    await expectAsync(loadRouteComponent(route)).toBeResolvedTo(StubComponent);
  });

  it('rejects when the route has no loadComponent loader', async () => {
    await expectAsync(loadRouteComponent({ path: '' })).toBeRejectedWithError(
      /declare a loadComponent loader/
    );
  });

  it('rejects when the route is undefined', async () => {
    await expectAsync(loadRouteComponent(undefined)).toBeRejectedWithError(
      /declare a loadComponent loader/
    );
  });

  it('rejects when the loader resolves to something that is not a component', async () => {
    // Deliberately ill-typed: the guard exists for loaders whose target stopped exporting
    // a component, which by definition cannot be expressed through `Route`'s own types.
    const route = {
      path: '',
      loadComponent: () => Promise.resolve({ notAComponent: true }),
    } as unknown as Route;
    await expectAsync(loadRouteComponent(route)).toBeRejectedWithError(
      /resolve to a component class/
    );
  });
});
