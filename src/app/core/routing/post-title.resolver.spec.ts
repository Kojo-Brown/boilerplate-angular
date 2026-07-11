import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, convertToParamMap } from '@angular/router';
import { PostsService } from '@/app/features/posts/posts.service';
import { postTitleResolver } from './post-title.resolver';

describe('postTitleResolver', () => {
  let postsServiceSpy: jasmine.SpyObj<PostsService>;

  beforeEach(() => {
    postsServiceSpy = jasmine.createSpyObj<PostsService>('PostsService', ['getById']);
    TestBed.configureTestingModule({
      providers: [{ provide: PostsService, useValue: postsServiceSpy }],
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
    postsServiceSpy.getById.and.returnValue(
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
    postsServiceSpy.getById.and.returnValue(Promise.reject(new Error('not found')));

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
    expect(postsServiceSpy.getById).not.toHaveBeenCalled();
  });
});
