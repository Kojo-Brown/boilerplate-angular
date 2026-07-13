import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { loggingInterceptor } from './logging.interceptor';

describe('loggingInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;
  let debugSpy: jasmine.Spy;
  let errorSpy: jasmine.Spy;

  beforeEach(() => {
    debugSpy = spyOn(console, 'debug');
    errorSpy = spyOn(console, 'error');

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([loggingInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => controller.verify());

  it('passes the response through unmodified', (done) => {
    http.get<{ ok: boolean }>('/api/data').subscribe({
      next: (res) => {
        expect(res.ok).toBeTrue();
        done();
      },
    });
    controller.expectOne('/api/data').flush({ ok: true });
  });

  it('logs a debug message on successful response in dev mode', (done) => {
    http.get('/api/data').subscribe({
      next: () => {
        expect(debugSpy).toHaveBeenCalledWith(
          jasmine.stringMatching(/\[HTTP\] GET \/api\/data → 200/)
        );
        done();
      },
    });
    controller.expectOne('/api/data').flush({});
  });

  it('logs an error message on HTTP error in dev mode', (done) => {
    http.get('/api/broken').subscribe({
      error: () => {
        expect(errorSpy).toHaveBeenCalledWith(
          jasmine.stringMatching(/\[HTTP\] GET \/api\/broken → ERROR/),
          jasmine.anything()
        );
        done();
      },
    });
    controller
      .expectOne('/api/broken')
      .flush({ message: 'fail' }, { status: 500, statusText: 'Server Error' });
  });

  it('passes through error responses to the subscriber', (done) => {
    http.get('/api/gone').subscribe({
      error: (err: { status: number }) => {
        expect(err.status).toBe(410);
        done();
      },
    });
    controller
      .expectOne('/api/gone')
      .flush({}, { status: 410, statusText: 'Gone' });
  });
});
