import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, convertToParamMap } from '@angular/router';
import { PostReader } from '@/app/features/posts/posts.contracts';
import { postTitleResolver } from './post-title.resolver';

describe('postTitleResolver', () => {
  let readerSpy: jasmine.SpyObj<PostReader>;

  beforeEach(() => {
    readerSpy = jasmine.createSpyObj<PostReader>('PostReader', ['getById']);
    TestBed.configureTestingModule({
      providers: [{ provide: PostReader, useValue: readerSpy }],
    });
  });

  function buildRoute(id: string): ActivatedRouteSnapshot {
    const route = new ActivatedRouteSnapshot();
    Object.defineProperty(route, 'paramMap', {
      get: () => convertToParamMap({ id }),
    });
    return route;
  }

  it('returns the post title when fetch succeeds', async () => {
    readerSpy.getById.and.returnValue(
      Promise.resolve({
        id: '1',
        title: 'Hello World',
        body: 'body',
        authorId: 'u1',
        createdAt: '',
        updatedAt: '',
      })
    );

    const result = await TestBed.runInInjectionContext(() =>
      postTitleResolver(buildRoute('1'), {} as never)
    );

    expect(result).toBe('Hello World');
  });

  it('returns "Post Detail" when fetch fails', async () => {
    readerSpy.getById.and.returnValue(Promise.reject(new Error('not found')));

    const result = await TestBed.runInInjectionContext(() =>
      postTitleResolver(buildRoute('1'), {} as never)
    );

    expect(result).toBe('Post Detail');
  });

  it('returns "Post Detail" when id is empty', async () => {
    const result = await TestBed.runInInjectionContext(() =>
      postTitleResolver(buildRoute(''), {} as never)
    );

    expect(result).toBe('Post Detail');
    expect(readerSpy.getById).not.toHaveBeenCalled();
  });
});
