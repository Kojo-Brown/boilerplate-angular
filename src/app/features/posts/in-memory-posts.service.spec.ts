import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { createMockPost } from '@/testing';
import type { ApiError } from '@/app/core/http/models/api.models';
import {
  IN_MEMORY_AUTHOR_ID,
  IN_MEMORY_POSTS_CLOCK,
  IN_MEMORY_POSTS_SEED,
  InMemoryPostsService,
} from './in-memory-posts.service';
import { providePostsBackend } from './posts.providers';
import type { Post } from './posts.models';

const NOW = '2026-05-05T12:00:00.000Z';

/** Ten posts, so the default page size of 10 has an eleventh to leave off. */
function catalogue(count: number): Post[] {
  return Array.from({ length: count }, (_, index) =>
    createMockPost({
      id: `seed-${index + 1}`,
      title: `Seed post ${index + 1}`,
      body: index === 0 ? 'Signals and reactivity' : `Body ${index + 1}`,
      authorId: IN_MEMORY_AUTHOR_ID,
    })
  );
}

function configure(seed: readonly Post[]): InMemoryPostsService {
  TestBed.configureTestingModule({
    providers: [
      ...providePostsBackend(InMemoryPostsService),
      { provide: IN_MEMORY_POSTS_SEED, useValue: seed },
      { provide: IN_MEMORY_POSTS_CLOCK, useValue: () => NOW },
    ],
  });
  return TestBed.inject(InMemoryPostsService);
}

describe('InMemoryPostsService', () => {
  let service: InMemoryPostsService;
  let seed: Post[];

  beforeEach(() => {
    seed = catalogue(11);
    service = configure(seed);
  });

  describe('the default seed', () => {
    it('serves a catalogue when nothing overrides IN_MEMORY_POSTS_SEED', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: providePostsBackend(InMemoryPostsService) });

      const page = await TestBed.inject(InMemoryPostsService).getAll();

      expect(page.total).toBeGreaterThan(0);
      expect(page.data[0].id).toBe('post-1');
    });
  });

  describe('getAll()', () => {
    it('returns the first page at the default page size', async () => {
      const page = await service.getAll();

      expect(page.data.length).toBe(10);
      expect(page.data[0].id).toBe('seed-1');
      expect(page.total).toBe(11);
      expect(page.page).toBe(1);
      expect(page.pageSize).toBe(10);
      expect(page.totalPages).toBe(2);
    });

    it('honours page and pageSize', async () => {
      const page = await service.getAll({ page: 2, pageSize: 4 });

      expect(page.data.map((post) => post.id)).toEqual(['seed-5', 'seed-6', 'seed-7', 'seed-8']);
      expect(page.totalPages).toBe(3);
    });

    it('returns an empty page past the end rather than wrapping', async () => {
      const page = await service.getAll({ page: 99, pageSize: 5 });

      expect(page.data).toEqual([]);
      expect(page.total).toBe(11);
    });

    it('filters on search, case-insensitively, across title and body', async () => {
      const byTitle = await service.getAll({ search: 'SEED POST 3' });
      const byBody = await service.getAll({ search: 'signals' });

      expect(byTitle.data.map((post) => post.id)).toEqual(['seed-3']);
      expect(byBody.data.map((post) => post.id)).toEqual(['seed-1']);
    });

    it('treats a blank search as no search', async () => {
      const page = await service.getAll({ search: '   ' });

      expect(page.total).toBe(11);
    });

    it('reports one page, not zero, when nothing matches', async () => {
      const page = await service.getAll({ search: 'nothing matches this' });

      expect(page.data).toEqual([]);
      expect(page.total).toBe(0);
      expect(page.totalPages).toBe(1);
    });
  });

  describe('getById()', () => {
    it('returns the post', async () => {
      const post = await service.getById('seed-2');

      expect(post.title).toBe('Seed post 2');
    });

    /**
     * The shape matters as much as the rejection. `errorInterceptor` normalises a real
     * 404 into an `ApiError`, so a backend that rejected with a bare `Error` would let a
     * spec pass against error handling the HTTP path would break.
     */
    it('rejects with an ApiError-shaped 404 for an unknown id', async () => {
      await expectAsync(service.getById('missing')).toBeRejectedWith({
        status: 404,
        message: 'Post missing not found.',
      } satisfies ApiError);
    });
  });

  describe('search()', () => {
    it('matches on title and body and caps at the limit', async () => {
      const results = await firstValueFrom(service.search('Seed post', 3));

      expect(results.length).toBe(3);
    });

    it('defaults the limit to 10, as HttpPostsService does', async () => {
      const results = await firstValueFrom(service.search('Seed post'));

      expect(results.length).toBe(10);
    });

    /** `defer`, not a bare `of`: the query runs on subscription, not on the call. */
    it('reads the catalogue as it is when subscribed, not when called', async () => {
      const pending = service.search('Freshly written');
      await service.create({ title: 'Freshly written', body: 'Added after the call.' });

      expect((await firstValueFrom(pending)).length).toBe(1);
    });
  });

  describe('create()', () => {
    it('stamps both timestamps from the clock and attributes the author', async () => {
      const post = await service.create({ title: 'New', body: 'Body' });

      expect(post.createdAt).toBe(NOW);
      expect(post.updatedAt).toBe(NOW);
      expect(post.authorId).toBe(IN_MEMORY_AUTHOR_ID);
    });

    it('is visible to a subsequent read', async () => {
      const post = await service.create({ title: 'New', body: 'Body' });

      expect((await service.getById(post.id)).title).toBe('New');
      expect((await service.getAll()).total).toBe(12);
    });

    it('never hands out an id the seed already used', async () => {
      const collidingSeed = [createMockPost({ id: 'post-1' }), createMockPost({ id: 'post-2' })];
      TestBed.resetTestingModule();
      const fresh = configure(collidingSeed);

      const post = await fresh.create({ title: 'Third', body: 'Body' });

      expect(post.id).toBe('post-3');
    });
  });

  describe('update()', () => {
    it('applies only the fields the DTO carries and bumps updatedAt', async () => {
      const updated = await service.update('seed-2', { title: 'Retitled' });

      expect(updated.title).toBe('Retitled');
      expect(updated.body).toBe('Body 2');
      expect(updated.createdAt).toBe(seed[1].createdAt);
      expect(updated.updatedAt).toBe(NOW);
    });

    it('replaces rather than mutates, so a post already handed out is unchanged', async () => {
      const before = await service.getById('seed-2');

      await service.update('seed-2', { title: 'Retitled' });

      expect(before.title).toBe('Seed post 2');
      expect((await service.getById('seed-2')).title).toBe('Retitled');
    });

    it('leaves the injected seed array alone', async () => {
      await service.update('seed-2', { title: 'Retitled' });
      await service.remove('seed-1');

      expect(seed.length).toBe(11);
      expect(seed[1].title).toBe('Seed post 2');
    });

    it('rejects with a 404 for an unknown id', async () => {
      await expectAsync(service.update('missing', { title: 'x' })).toBeRejectedWith({
        status: 404,
        message: 'Post missing not found.',
      } satisfies ApiError);
    });
  });

  describe('remove()', () => {
    it('drops the post', async () => {
      await service.remove('seed-1');

      expect((await service.getAll()).total).toBe(10);
      await expectAsync(service.getById('seed-1')).toBeRejected();
    });

    it('rejects with a 404 for an unknown id', async () => {
      await expectAsync(service.remove('missing')).toBeRejectedWith({
        status: 404,
        message: 'Post missing not found.',
      } satisfies ApiError);
    });
  });

  describe('AbortSignal', () => {
    it('rejects an already-aborted getAll with the signal reason', async () => {
      const controller = new AbortController();
      const reason = new Error('superseded');
      controller.abort(reason);

      await expectAsync(service.getAll({}, controller.signal)).toBeRejectedWith(reason);
    });

    /**
     * `resource()` calls `abort()` with no reason, so the rejection has to be the same
     * `AbortError` `abortableRequest` synthesises — otherwise a loader could tell the
     * two backends apart by what it was aborted with.
     */
    it('rejects a reasonless abort with an AbortError, as abortableRequest does', async () => {
      const controller = new AbortController();
      controller.abort();

      const rejection = await service.getById('seed-1', controller.signal).then(
        () => null,
        (error: unknown) => error
      );

      expect(rejection instanceof DOMException).toBeTrue();
      expect((rejection as DOMException).name).toBe('AbortError');
    });

    it('serves a read whose signal has not aborted', async () => {
      const controller = new AbortController();

      expect((await service.getById('seed-1', controller.signal)).id).toBe('seed-1');
    });
  });
});
