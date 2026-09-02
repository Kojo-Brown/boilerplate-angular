import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { HttpPostsService } from './http-posts.service';
import { providePostsBackend } from './posts.providers';
import { queryKeys } from '@/app/core/query/query-keys';

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

describe('queryKeys', () => {
  it('posts.all() returns base key', () => {
    expect(queryKeys.posts.all()).toEqual(['posts']);
  });

  it('posts.lists() returns list key', () => {
    expect(queryKeys.posts.lists()).toEqual(['posts', 'list']);
  });

  it('posts.list(filters) includes filters', () => {
    expect(queryKeys.posts.list({ page: 1 })).toEqual(['posts', 'list', { page: 1 }]);
  });

  it('posts.detail(id) includes id', () => {
    expect(queryKeys.posts.detail('abc')).toEqual(['posts', 'detail', 'abc']);
  });

  it('users.all() returns base key', () => {
    expect(queryKeys.users.all()).toEqual(['users']);
  });

  it('users.me() returns the current-user key', () => {
    expect(queryKeys.users.me()).toEqual(['users', 'me']);
  });

  it('users.detail(id) includes id', () => {
    expect(queryKeys.users.detail('u1')).toEqual(['users', 'detail', 'u1']);
  });

  it('nests list and detail keys under their base key so invalidation cascades', () => {
    // `invalidateQueries({ queryKey: posts.all() })` must also match list/detail entries;
    // that only holds while the base key stays a prefix of the more specific ones.
    expect(queryKeys.posts.lists().slice(0, 1)).toEqual([...queryKeys.posts.all()]);
    expect(queryKeys.posts.detail('abc').slice(0, 1)).toEqual([...queryKeys.posts.all()]);
    expect(queryKeys.users.me().slice(0, 1)).toEqual([...queryKeys.users.all()]);
    expect(queryKeys.users.detail('u1').slice(0, 1)).toEqual([...queryKeys.users.all()]);
  });
});

describe('HttpPostsService', () => {
  let service: HttpPostsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTanStackQuery(createTestQueryClient()),
        ...providePostsBackend(HttpPostsService),
      ],
    });

    service = TestBed.inject(HttpPostsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('getAll() calls GET /posts', async () => {
    const mockResponse = {
      data: [
        { id: '1', title: 'Hello', body: 'World', authorId: 'u1', createdAt: '', updatedAt: '' },
      ],
      total: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    };

    const promise = service.getAll();
    const req = httpMock.expectOne((r) => r.url.includes('/posts'));
    req.flush(mockResponse);
    const result = await promise;

    expect(result.data.length).toBe(1);
    expect(result.data[0].title).toBe('Hello');
  });

  it('getById() calls GET /posts/:id', async () => {
    const mockPost = {
      id: '1',
      title: 'Test',
      body: 'Body',
      authorId: 'u1',
      createdAt: '',
      updatedAt: '',
    };
    const promise = service.getById('1');
    const req = httpMock.expectOne((r) => r.url.includes('/posts/1'));
    req.flush(mockPost);
    const result = await promise;

    expect(result.id).toBe('1');
  });

  it('create() calls POST /posts', async () => {
    const dto = { title: 'New Post', body: 'Content' };
    const mockPost = { id: '2', ...dto, authorId: 'u1', createdAt: '', updatedAt: '' };
    const promise = service.create(dto);
    const req = httpMock.expectOne((r) => r.url.includes('/posts') && r.method === 'POST');
    req.flush(mockPost);
    const result = await promise;

    expect(result.title).toBe('New Post');
  });

  it('update() calls PATCH /posts/:id', async () => {
    const dto = { title: 'Updated' };
    const mockPost = {
      id: '1',
      title: 'Updated',
      body: 'Body',
      authorId: 'u1',
      createdAt: '',
      updatedAt: '',
    };
    const promise = service.update('1', dto);
    const req = httpMock.expectOne((r) => r.url.includes('/posts/1') && r.method === 'PATCH');
    req.flush(mockPost);
    const result = await promise;

    expect(result.title).toBe('Updated');
  });

  it('remove() calls DELETE /posts/:id', async () => {
    const promise = service.remove('1');
    const req = httpMock.expectOne((r) => r.url.includes('/posts/1') && r.method === 'DELETE');
    req.flush(null);
    await promise;

    expect(req.request.method).toBe('DELETE');
  });
});
