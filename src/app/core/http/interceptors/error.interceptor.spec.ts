import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { EnvironmentProviders } from '@angular/core';
import { errorInterceptor } from './error.interceptor';
import {
  BUILT_IN_API_ERROR_MAPPERS,
  NETWORK_ERROR_MESSAGE,
  provideApiErrorMappers,
  type ApiErrorMapper,
} from '../errors/api-error-mappers';
import type { ApiError } from '../models/api.models';

describe('errorInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;

  /**
   * The interceptor plus whichever strategies the spec is about. The default is the set
   * `app.config.ts` registers, so the assertions below describe the shipped application
   * rather than a configuration that only exists here.
   */
  function setup(
    mappers: EnvironmentProviders = provideApiErrorMappers(...BUILT_IN_API_ERROR_MAPPERS)
  ): void {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        mappers,
      ],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
  }

  afterEach(() => controller.verify());

  it('passes through successful responses unchanged', (done) => {
    setup();
    http.get<{ id: number }>('/api/items').subscribe({
      next: (res) => {
        expect(res.id).toBe(1);
        done();
      },
    });
    controller.expectOne('/api/items').flush({ id: 1 });
  });

  it('maps HttpErrorResponse with message body to ApiError', (done) => {
    setup();
    http.get('/api/items').subscribe({
      error: (err: ApiError) => {
        expect(err.status).toBe(404);
        expect(err.message).toBe('Not found');
        done();
      },
    });
    controller
      .expectOne('/api/items')
      .flush({ message: 'Not found' }, { status: 404, statusText: 'Not Found' });
  });

  it('maps HttpErrorResponse without body message using statusText', (done) => {
    setup();
    http.get('/api/items').subscribe({
      error: (err: ApiError) => {
        expect(err.status).toBe(500);
        expect(err.message).toBeTruthy();
        done();
      },
    });
    controller
      .expectOne('/api/items')
      .flush({}, { status: 500, statusText: 'Internal Server Error' });
  });

  it('includes validation errors from body.errors', (done) => {
    setup();
    http.post('/api/items', {}).subscribe({
      error: (err: ApiError) => {
        expect(err.status).toBe(422);
        expect(err.errors).toEqual({ title: ['is required'] });
        done();
      },
    });
    controller
      .expectOne('/api/items')
      .flush(
        { message: 'Validation failed', errors: { title: ['is required'] } },
        { status: 422, statusText: 'Unprocessable Entity' }
      );
  });

  it('maps a 401 response to ApiError with status 401', (done) => {
    setup();
    http.get('/api/protected').subscribe({
      error: (err: ApiError) => {
        expect(err.status).toBe(401);
        done();
      },
    });
    controller
      .expectOne('/api/protected')
      .flush({ message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });
  });

  it('reports a request that never reached the server as a network error', (done) => {
    setup();
    http.get('/api/items').subscribe({
      error: (err: ApiError) => {
        expect(err).toEqual({ status: 0, message: NETWORK_ERROR_MESSAGE });
        done();
      },
    });
    controller.expectOne('/api/items').error(new ProgressEvent('error'));
  });

  it('reads an RFC 9457 body when the server sends one', (done) => {
    setup();
    http.get('/api/items').subscribe({
      error: (err: ApiError) => {
        expect(err.message).toBe('Title must be present.');
        done();
      },
    });
    controller.expectOne('/api/items').flush(
      { title: 'Unprocessable Entity', detail: 'Title must be present.' },
      {
        status: 422,
        statusText: 'Unprocessable Entity',
        headers: { 'content-type': 'application/problem+json' },
      }
    );
  });

  // The extension point, exercised the way an application would use it: a mapper for a
  // format the built-ins do not know, listed ahead of them because this gateway's bodies
  // also carry a `message` key that `message-envelope` would otherwise read first.
  it('lets an application add a strategy for a format the built-ins do not know', (done) => {
    const legacyGateway: ApiErrorMapper = {
      name: 'legacy-gateway',
      map: (error) => {
        const body = error.error as { err_code?: number; err_msg?: string } | null;
        return body?.err_msg === undefined ? null : { status: error.status, message: body.err_msg };
      },
    };
    setup(provideApiErrorMappers(legacyGateway, ...BUILT_IN_API_ERROR_MAPPERS));

    http.get('/api/items').subscribe({
      error: (err: ApiError) => {
        expect(err.message).toBe('quota exhausted');
        done();
      },
    });
    controller
      .expectOne('/api/items')
      .flush(
        { err_code: 42, err_msg: 'quota exhausted', message: 'Bad Request' },
        { status: 400, statusText: 'Bad Request' }
      );
  });

  // Registering the token replaces the list rather than merging with a hidden default,
  // which is the half of the contract a caller is most likely to guess wrong.
  it('consults only the strategies that were registered', (done) => {
    setup(provideApiErrorMappers());

    http.get('/api/items').subscribe({
      error: (err: ApiError) => {
        expect(err.status).toBe(404);
        expect(err.message).not.toBe('Not found');
        done();
      },
    });
    controller
      .expectOne('/api/items')
      .flush({ message: 'Not found' }, { status: 404, statusText: 'Not Found' });
  });
});
