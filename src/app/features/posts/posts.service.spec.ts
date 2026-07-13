import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { PostsService } from './posts.service';
import { environment } from '@/environments/environment';
import { createMockPost } from '@/testing';
import type { PaginatedResponse } from '@/app/core/http/models/api.models';
import type { Post } from './posts.models';

const BASE = `${environment.apiUrl}/posts`;

describe('PostsService', () => {
  let service: PostsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(PostsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getAll()', () => {
    it('GETs /posts and returns paginated response', async () => {
      const post = createMockPost();
      const page: PaginatedResponse<Post> = {
        data: [post],
        total: 1,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      };

      const promise = service.getAll();
      http.expectOne(BASE).flush(page);
      const result = await promise;

      expect(result.data.length).toBe(1);
      expect(result.total).toBe(1);
    });

    it('appends pagination query params', async () => {
      const page: PaginatedResponse<Post> = {
        data: [],
        total: 0,
        page: 2,
        pageSize: 5,
        totalPages: 0,
      };

      const promise = service.getAll({ page: 2, pageSize: 5 });
      const req = http.expectOne((r) => r.url === BASE);
      expect(req.request.params.get('page')).toBe('2');
      expect(req.request.params.get('pageSize')).toBe('5');
      req.flush(page);
      await promise;
    });

    it('appends search query param', async () => {
      const empty: PaginatedResponse<Post> = {
        data: [],
        total: 0,
        page: 1,
        pageSize: 10,
        totalPages: 0,
      };

      const promise = service.getAll({ search: 'angular' });
      const req = http.expectOne((r) => r.url === BASE);
      expect(req.request.params.get('search')).toBe('angular');
      req.flush(empty);
      await promise;
    });
  });

  describe('getById()', () => {
    it('GETs /posts/:id', async () => {
      const post = createMockPost({ id: 'abc' });
      const promise = service.getById('abc');
      http.expectOne(`${BASE}/abc`).flush(post);
      const result = await promise;
      expect(result.id).toBe('abc');
    });
  });

  describe('create()', () => {
    it('POSTs to /posts with dto', async () => {
      const dto = { title: 'Hello', body: 'World' };
      const created = createMockPost(dto);
      const promise = service.create(dto);
      const req = http.expectOne(BASE);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(dto);
      req.flush(created);
      const result = await promise;
      expect(result.title).toBe('Hello');
    });
  });

  describe('update()', () => {
    it('PATCHes /posts/:id with dto', async () => {
      const post = createMockPost({ id: '1', title: 'Updated' });
      const promise = service.update('1', { title: 'Updated' });
      const req = http.expectOne(`${BASE}/1`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ title: 'Updated' });
      req.flush(post);
      const result = await promise;
      expect(result.title).toBe('Updated');
    });
  });

  describe('remove()', () => {
    it('DELETEs /posts/:id', async () => {
      const promise = service.remove('42');
      const req = http.expectOne(`${BASE}/42`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
      await promise;
    });
  });
});
