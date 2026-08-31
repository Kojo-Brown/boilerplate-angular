import { HttpClient, HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import type { HttpInterceptorFn } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { InjectionToken, inject } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { switchMap, timer } from 'rxjs';
import {
  composeInterceptors,
  interceptWhen,
  passThroughInterceptor,
  requestsUnder,
  requestsWithMethod,
} from './compose';

const MARKER = new InjectionToken<string>('MARKER', {
  providedIn: 'root',
  factory: () => 'from-di',
});

/** Appends `name` to an `X-Trail` header, so the finished header reads as the call order. */
function trailInterceptor(name: string): HttpInterceptorFn {
  return (req, next) => {
    const trail = req.headers.get('X-Trail');
    return next(
      req.clone({ setHeaders: { 'X-Trail': trail === null ? name : `${trail},${name}` } })
    );
  };
}

describe('composeInterceptors', () => {
  function setup(interceptors: readonly HttpInterceptorFn[]): {
    http: HttpClient;
    controller: HttpTestingController;
  } {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([...interceptors])),
        provideHttpClientTesting(),
      ],
    });
    return {
      http: TestBed.inject(HttpClient),
      controller: TestBed.inject(HttpTestingController),
    };
  }

  it('applies the interceptors left to right, first argument outermost', () => {
    const { http, controller } = setup([
      composeInterceptors(trailInterceptor('a'), trailInterceptor('b'), trailInterceptor('c')),
    ]);

    http.get('/api/thing').subscribe();

    const request = controller.expectOne('/api/thing');
    expect(request.request.headers.get('X-Trail')).toBe('a,b,c');
    request.flush({});
    controller.verify();
  });

  it('nests inside the surrounding withInterceptors list rather than replacing it', () => {
    const { http, controller } = setup([
      trailInterceptor('outer'),
      composeInterceptors(trailInterceptor('inner')),
      trailInterceptor('last'),
    ]);

    http.get('/api/thing').subscribe();

    const request = controller.expectOne('/api/thing');
    expect(request.request.headers.get('X-Trail')).toBe('outer,inner,last');
    request.flush({});
    controller.verify();
  });

  it('passes the request straight through when composing nothing', () => {
    const { http, controller } = setup([composeInterceptors()]);

    http.get('/api/thing').subscribe();

    controller.expectOne('/api/thing').flush({});
    controller.verify();
  });

  // The reason the fold runs each interceptor through `runInInjectionContext`. An
  // interceptor that defers its `next()` call — `jwtInterceptor` waiting on a token
  // refresh does exactly this — resumes on a later task, by which point the ambient
  // injection context is gone and a naive fold would fail the interceptor beneath it
  // with NG0203 instead of sending the request.
  it('keeps inject() legal in an interceptor called after an async boundary', fakeAsync(() => {
    const deferring: HttpInterceptorFn = (req, next) => timer(10).pipe(switchMap(() => next(req)));
    const injecting: HttpInterceptorFn = (req, next) =>
      next(req.clone({ setHeaders: { 'X-Marker': inject(MARKER) } }));

    const { http, controller } = setup([composeInterceptors(deferring, injecting)]);

    http.get('/api/thing').subscribe();
    tick(10);

    const request = controller.expectOne('/api/thing');
    expect(request.request.headers.get('X-Marker')).toBe('from-di');
    request.flush({});
    controller.verify();
  }));
});

describe('interceptWhen', () => {
  function setup(interceptor: HttpInterceptorFn): {
    http: HttpClient;
    controller: HttpTestingController;
  } {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([interceptor])), provideHttpClientTesting()],
    });
    return {
      http: TestBed.inject(HttpClient),
      controller: TestBed.inject(HttpTestingController),
    };
  }

  it('applies the decorator to a request the predicate accepts', () => {
    const { http, controller } = setup(
      interceptWhen(requestsUnder('/api/'), trailInterceptor('scoped'))
    );

    http.get('/api/thing').subscribe();

    const request = controller.expectOne('/api/thing');
    expect(request.request.headers.get('X-Trail')).toBe('scoped');
    request.flush({});
    controller.verify();
  });

  it('leaves a request the predicate rejects untouched', () => {
    const { http, controller } = setup(
      interceptWhen(requestsUnder('/api/'), trailInterceptor('scoped'))
    );

    http.get('https://cdn.example.test/logo.svg').subscribe();

    const request = controller.expectOne('https://cdn.example.test/logo.svg');
    expect(request.request.headers.has('X-Trail')).toBeFalse();
    request.flush({});
    controller.verify();
  });

  it('does not evaluate the decorator at all for a rejected request', () => {
    const decorator = jasmine
      .createSpy<HttpInterceptorFn>('decorator')
      .and.callFake(trailInterceptor('scoped'));
    const { http, controller } = setup(interceptWhen(() => false, decorator));

    http.get('/api/thing').subscribe();

    controller.expectOne('/api/thing').flush({});
    expect(decorator).not.toHaveBeenCalled();
    controller.verify();
  });
});

describe('requestsUnder', () => {
  const predicate = requestsUnder('http://localhost:3000/api/v1');

  it('accepts a URL beginning with the base', () => {
    expect(predicate(request('http://localhost:3000/api/v1/posts'))).toBeTrue();
  });

  it('rejects a URL that merely contains the base', () => {
    expect(predicate(request('http://evil.test/?to=http://localhost:3000/api/v1'))).toBeFalse();
  });

  it('rejects a different origin', () => {
    expect(predicate(request('http://localhost:4000/api/v1/posts'))).toBeFalse();
  });
});

describe('requestsWithMethod', () => {
  const predicate = requestsWithMethod('get', 'HEAD');

  it('matches case-insensitively in both directions', () => {
    expect(predicate(request('/api/a', 'GET'))).toBeTrue();
    expect(predicate(request('/api/a', 'head'))).toBeTrue();
  });

  it('rejects a method it was not given', () => {
    expect(predicate(request('/api/a', 'POST'))).toBeFalse();
  });
});

describe('passThroughInterceptor', () => {
  it('changes nothing about the request', () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([passThroughInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    const http = TestBed.inject(HttpClient);
    const controller = TestBed.inject(HttpTestingController);

    http.get('/api/thing').subscribe();

    const request = controller.expectOne('/api/thing');
    expect(request.request.headers.keys()).toEqual([]);
    request.flush({});
    controller.verify();
  });
});

/** The predicates take a request and read two fields off it; this builds the smallest one. */
function request(url: string, method = 'GET'): HttpRequest<unknown> {
  return new HttpRequest<unknown>(method, url, null);
}
