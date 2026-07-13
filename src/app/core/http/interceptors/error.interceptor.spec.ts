import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { errorInterceptor } from './error.interceptor';
import type { ApiError } from '../models/api.models';

describe('errorInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => controller.verify());

  it('passes through successful responses unchanged', (done) => {
    http.get<{ id: number }>('/api/items').subscribe({
      next: (res) => {
        expect(res.id).toBe(1);
        done();
      },
    });
    controller.expectOne('/api/items').flush({ id: 1 });
  });

  it('maps HttpErrorResponse with message body to ApiError', (done) => {
    http.get('/api/items').subscribe({
      error: (err: ApiError) => {
        expect(err.status).toBe(404);
        expect(err.message).toBe('Not found');
        done();
      },
    });
    controller.expectOne('/api/items').flush(
      { message: 'Not found' },
      { status: 404, statusText: 'Not Found' }
    );
  });

  it('maps HttpErrorResponse without body message using statusText', (done) => {
    http.get('/api/items').subscribe({
      error: (err: ApiError) => {
        expect(err.status).toBe(500);
        expect(err.message).toBeTruthy();
        done();
      },
    });
    controller.expectOne('/api/items').flush(
      {},
      { status: 500, statusText: 'Internal Server Error' }
    );
  });

  it('includes validation errors from body.errors', (done) => {
    http.post('/api/items', {}).subscribe({
      error: (err: ApiError) => {
        expect(err.status).toBe(422);
        expect(err.errors).toEqual({ title: ['is required'] });
        done();
      },
    });
    controller.expectOne('/api/items').flush(
      { message: 'Validation failed', errors: { title: ['is required'] } },
      { status: 422, statusText: 'Unprocessable Entity' }
    );
  });

  it('maps a 401 response to ApiError with status 401', (done) => {
    http.get('/api/protected').subscribe({
      error: (err: ApiError) => {
        expect(err.status).toBe(401);
        done();
      },
    });
    controller.expectOne('/api/protected').flush(
      { message: 'Unauthorized' },
      { status: 401, statusText: 'Unauthorized' }
    );
  });
});
