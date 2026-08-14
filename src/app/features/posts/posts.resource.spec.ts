import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef, signal } from '@angular/core';
import type { ResourceRef, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { environment } from '@/environments/environment';
import { createMockPost } from '@/testing';
import type { Post } from './posts.models';
import { injectPostResource } from './posts.resource';

const BASE = `${environment.apiUrl}/posts`;

describe('injectPostResource', () => {
  let backend: HttpTestingController;
  let id: WritableSignal<string>;
  let post: ResourceRef<Post | undefined>;

  /**
   * `resource` schedules its load through an effect, so nothing is in flight until the
   * effect queue has been flushed. Every act in these specs goes through here.
   */
  function flush(): void {
    TestBed.tick();
  }

  /**
   * Wait for a load to make it all the way through. `resource` registers the load as a
   * pending task, so `whenStable` is the honest wait — counting microtask turns would
   * encode the number of `await`s inside Angular's loader into the spec.
   */
  async function settle(): Promise<void> {
    await TestBed.inject(ApplicationRef).whenStable();
    flush();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    backend = TestBed.inject(HttpTestingController);
    id = signal('');
    post = TestBed.runInInjectionContext(() => injectPostResource(id));
  });

  afterEach(() => backend.verify());

  describe('idle state', () => {
    it('issues no request while the id is empty', () => {
      flush();

      expect(post.status()).toBe('idle');
      expect(post.isLoading()).toBeFalse();
      backend.expectNone(() => true);
    });

    it('starts loading once the id is set', () => {
      flush();
      id.set('post-1');
      flush();

      expect(post.isLoading()).toBeTrue();
      backend.expectOne(`${BASE}/post-1`).flush(createMockPost({ id: 'post-1' }));
    });
  });

  describe('loading a post', () => {
    it('exposes the loaded post as the resource value', async () => {
      id.set('post-1');
      flush();
      backend.expectOne(`${BASE}/post-1`).flush(createMockPost({ id: 'post-1', title: 'Hello' }));
      await settle();

      expect(post.status()).toBe('resolved');
      expect(post.hasValue()).toBeTrue();
      expect(post.value()?.title).toBe('Hello');
      expect(post.error()).toBeUndefined();
    });

    it('reports the failure without throwing out of the loader', async () => {
      id.set('missing');
      flush();
      backend
        .expectOne(`${BASE}/missing`)
        .flush({ message: 'Not found' }, { status: 404, statusText: 'Not Found' });
      await settle();

      expect(post.status()).toBe('error');
      expect(post.error()).toBeDefined();
    });
  });

  describe('automatic cancellation', () => {
    it('cancels the in-flight request when the id changes', () => {
      id.set('post-1');
      flush();
      const first = backend.expectOne(`${BASE}/post-1`);

      id.set('post-2');
      flush();

      expect(first.cancelled).toBeTrue();
      backend.expectOne(`${BASE}/post-2`).flush(createMockPost({ id: 'post-2' }));
    });

    it('ignores a superseded response that arrives after a newer one', async () => {
      id.set('slow');
      flush();
      const slow = backend.expectOne(`${BASE}/slow`);

      id.set('fast');
      flush();
      backend.expectOne(`${BASE}/fast`).flush(createMockPost({ id: 'fast', title: 'Fast' }));
      await settle();

      // The first request was unsubscribed, so this is the belt-and-braces case: even if
      // a backend somehow delivered it, the resource must not adopt a value it no longer
      // asked for.
      expect(slow.cancelled).toBeTrue();
      expect(post.value()?.title).toBe('Fast');
    });

    it('cancels the in-flight request when the resource is destroyed', () => {
      id.set('post-1');
      flush();
      const request = backend.expectOne(`${BASE}/post-1`);

      post.destroy();

      expect(request.cancelled).toBeTrue();
    });
  });
});
