import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, ActivatedRouteSnapshot, convertToParamMap } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { postTitleResolver } from '@/app/core/routing/post-title.resolver';
import { HttpPostsService } from './http-posts.service';
import { InMemoryPostsService, IN_MEMORY_POSTS_SEED } from './in-memory-posts.service';
import { PostReader, PostSearcher, PostWriter } from './posts.contracts';
import { providePostsBackend } from './posts.providers';
import { PostDetailComponent } from './post-detail.component';
import { injectPostResource } from './posts.resource';
import type { Post } from './posts.models';

function seedPost(id: string, title: string): Post {
  return {
    id,
    title,
    body: `Body of ${title}`,
    authorId: 'author-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const SEED: readonly Post[] = [seedPost('p1', 'First post'), seedPost('p2', 'Second post')];

function configureWithInMemoryBackend(): void {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      ...providePostsBackend(InMemoryPostsService),
      { provide: IN_MEMORY_POSTS_SEED, useValue: SEED },
    ],
  });
}

describe('providePostsBackend', () => {
  describe('one instance behind three tokens', () => {
    beforeEach(() => configureWithInMemoryBackend());

    /**
     * `useExisting`, not `useClass`. Three `useClass` entries construct the backend three
     * times and Angular says nothing about it — the application boots and the reads work.
     */
    it('resolves all three roles to the same instance', () => {
      const backend = TestBed.inject(InMemoryPostsService);

      expect(TestBed.inject(PostReader)).toBe(backend);
      expect(TestBed.inject(PostSearcher)).toBe(backend);
      expect(TestBed.inject(PostWriter)).toBe(backend);
    });

    /**
     * The behaviour that identity buys, and the reason the previous spec is not just
     * pedantry: under `useClass` this fails, because the write lands in one instance and
     * the read is answered by another.
     */
    it('shows a write made through PostWriter to a read through PostReader', async () => {
      const created = await TestBed.inject(PostWriter).create({
        title: 'Written through PostWriter',
        body: 'Body',
      });

      const read = await TestBed.inject(PostReader).getById(created.id);
      const searched = await firstValueFrom(TestBed.inject(PostSearcher).search('PostWriter'));

      expect(read.title).toBe('Written through PostWriter');
      expect(searched.map((post) => post.id)).toEqual([created.id]);
    });
  });

  /**
   * The hazard `useExisting` avoids, demonstrated rather than asserted in a comment.
   *
   * Three `useClass` entries are three providers, and Angular constructs the class once
   * per provider without warning. Against a stateless HTTP wrapper that is invisible;
   * against a backend that holds state it is a write that vanishes.
   */
  it('would split the backend into one instance per token under useClass', async () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: IN_MEMORY_POSTS_SEED, useValue: SEED },
        { provide: PostReader, useClass: InMemoryPostsService },
        { provide: PostWriter, useClass: InMemoryPostsService },
      ],
    });
    const reader = TestBed.inject(PostReader);
    const writer = TestBed.inject(PostWriter);

    const created = await writer.create({ title: 'Lost write', body: 'Body' });

    expect<unknown>(reader).not.toBe(writer);
    await expectAsync(reader.getById(created.id)).toBeRejectedWith(
      jasmine.objectContaining({ status: 404 })
    );
  });

  describe('the roles are the only way in', () => {
    /**
     * Neither implementation is `providedIn: 'root'`. That is what stops
     * `inject(HttpPostsService)` from continuing to work next to the abstraction, which
     * would make the seam a convention rather than the only route.
     */
    it('provides nothing until a backend has been chosen', () => {
      TestBed.configureTestingModule({ providers: [] });

      expect(TestBed.inject(PostReader, null)).toBeNull();
      expect(TestBed.inject(PostSearcher, null)).toBeNull();
      expect(TestBed.inject(PostWriter, null)).toBeNull();
      expect(TestBed.inject(HttpPostsService, null)).toBeNull();
      expect(TestBed.inject(InMemoryPostsService, null)).toBeNull();
    });

    it('does not register the backend a caller did not ask for', () => {
      configureWithInMemoryBackend();

      expect(TestBed.inject(HttpPostsService, null)).toBeNull();
    });
  });

  /**
   * The payoff of the whole exercise: a consumer written against the abstraction runs
   * against either implementation, and against the in-memory one it needs no HTTP layer
   * configured at all — no `provideHttpClientTesting`, no `expectOne`, no hand-written
   * response body. What is exercised is the real read path, end to end.
   */
  describe('swapping the backend under a consumer', () => {
    beforeEach(() => configureWithInMemoryBackend());

    it('serves injectPostResource, which never names an implementation', async () => {
      const id = signal('p2');
      const resource = TestBed.runInInjectionContext(() => injectPostResource(id));

      TestBed.tick();
      await TestBed.inject(ApplicationRef).whenStable();
      TestBed.tick();

      expect(resource.value()?.title).toBe('Second post');
    });

    it('serves postTitleResolver, which lives in core/ and imports only the abstraction', async () => {
      const route = new ActivatedRouteSnapshot();
      Object.defineProperty(route, 'paramMap', { get: () => convertToParamMap({ id: 'p1' }) });

      const title = await TestBed.runInInjectionContext(() =>
        postTitleResolver(route, {} as never)
      );

      expect(title).toBe('First post');
    });

    it('serves a rendered component through the same swap', async () => {
      const fixture = TestBed.createComponent(PostDetailComponent);
      fixture.componentRef.setInput('id', 'p1');
      fixture.detectChanges();

      await TestBed.inject(ApplicationRef).whenStable();
      fixture.detectChanges();

      const heading = fixture.debugElement.query(By.css('h1'));
      expect(heading.nativeElement.textContent).toContain('First post');
    });

    it('surfaces the backend 404 as the resource error, exactly as the HTTP path does', async () => {
      const id = signal('does-not-exist');
      const resource = TestBed.runInInjectionContext(() => injectPostResource(id));

      TestBed.tick();
      await TestBed.inject(ApplicationRef).whenStable();
      TestBed.tick();

      // `resource()` wraps a loader rejection that is not an `Error` — which an
      // `ApiError` is not, by design, since `errorInterceptor` throws the same plain
      // object — so the backend's rejection is read through `cause`.
      const error = resource.error();
      const rejection = (error as { cause?: unknown } | undefined)?.cause ?? error;

      expect(resource.status()).toBe('error');
      expect(rejection).toEqual(
        jasmine.objectContaining({ status: 404, message: 'Post does-not-exist not found.' })
      );
    });
  });
});
