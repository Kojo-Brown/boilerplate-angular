import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { ApiService } from './api.service';
import { environment } from '@/environments/environment';

describe('ApiService', () => {
  let service: ApiService;
  let httpMock: HttpTestingController;

  const base = environment.apiUrl;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('get() issues GET with full URL', () => {
    service.get<{ id: number }>('/items').subscribe((res) => {
      expect(res.id).toBe(1);
    });
    const req = httpMock.expectOne(`${base}/items`);
    expect(req.request.method).toBe('GET');
    req.flush({ id: 1 });
  });

  it('get() appends query params', () => {
    service.get<unknown[]>('/items', { params: { page: 1, size: 10 } }).subscribe();
    const req = httpMock.expectOne((r) => r.url === `${base}/items`);
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('size')).toBe('10');
    req.flush([]);
  });

  it('post() issues POST with body', () => {
    const payload = { name: 'test' };
    service.post<{ id: number }>('/items', payload).subscribe((res) => {
      expect(res.id).toBe(42);
    });
    const req = httpMock.expectOne(`${base}/items`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(payload);
    req.flush({ id: 42 });
  });

  it('put() issues PUT with body', () => {
    service.put<void>('/items/1', { name: 'updated' }).subscribe();
    const req = httpMock.expectOne(`${base}/items/1`);
    expect(req.request.method).toBe('PUT');
    req.flush(null);
  });

  it('patch() issues PATCH with body', () => {
    service.patch<void>('/items/1', { name: 'patched' }).subscribe();
    const req = httpMock.expectOne(`${base}/items/1`);
    expect(req.request.method).toBe('PATCH');
    req.flush(null);
  });

  it('delete() issues DELETE', () => {
    service.delete<void>('/items/1').subscribe();
    const req = httpMock.expectOne(`${base}/items/1`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });
});
