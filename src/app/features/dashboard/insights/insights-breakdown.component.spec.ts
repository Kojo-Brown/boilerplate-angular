import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { host, settleUntil } from '@/testing';
import { createMockPost } from '@/testing/mock-factories';
import { IN_MEMORY_POSTS_SEED, InMemoryPostsService } from '../../posts/in-memory-posts.service';
import type { Post } from '../../posts/posts.models';
import { providePostsBackend } from '../../posts/posts.providers';
import { InsightsBreakdownComponent, bandPosts } from './insights-breakdown.component';

/** A post whose body is exactly `length` characters long. */
function postOfLength(length: number): Post {
  return createMockPost({ body: 'x'.repeat(length) });
}

describe('bandPosts', () => {
  it('puts each post in the band its body length falls in', () => {
    const bands = bandPosts([
      postOfLength(10),
      postOfLength(300),
      postOfLength(900),
      postOfLength(5000),
    ]);

    expect(bands.map((band) => band.posts)).toEqual([1, 1, 1, 1]);
  });

  it('treats each bound as exclusive', () => {
    // 199/200 and 599/600 are the two places an off-by-one would hide, and neither shows
    // up in a rendering assertion — both bands would still be non-empty.
    const bands = bandPosts([
      postOfLength(199),
      postOfLength(200),
      postOfLength(599),
      postOfLength(600),
    ]);

    expect(bands.map((band) => band.posts)).toEqual([1, 2, 1, 0]);
  });

  it('has no upper limit on the last band', () => {
    const bands = bandPosts([postOfLength(1_000_000)]);

    expect(bands[3].posts).toBe(1);
  });

  it('returns every band, including the empty ones', () => {
    // A table whose rows come and go with the data cannot be read at a glance, and a zero
    // is information: it says nobody writes long posts.
    const bands = bandPosts([postOfLength(10)]);

    expect(bands.length).toBe(4);
    expect(bands.map((band) => band.posts)).toEqual([1, 0, 0, 0]);
  });

  it('reports shares of the total, and zero rather than NaN for an empty page', () => {
    expect(bandPosts([postOfLength(10), postOfLength(300)]).map((b) => b.share)).toEqual([
      0.5, 0.5, 0, 0,
    ]);
    expect(bandPosts([]).every((band) => band.share === 0)).toBe(true);
  });
});

describe('InsightsBreakdownComponent', () => {
  function configure(seed: readonly Post[]): void {
    TestBed.configureTestingModule({
      imports: [InsightsBreakdownComponent],
      providers: [
        provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
        ...providePostsBackend(InMemoryPostsService),
        { provide: IN_MEMORY_POSTS_SEED, useValue: seed },
      ],
    });
  }

  async function render(
    seed: readonly Post[]
  ): Promise<ComponentFixture<InsightsBreakdownComponent>> {
    configure(seed);
    const fixture = TestBed.createComponent(InsightsBreakdownComponent);
    fixture.detectChanges();
    await settleUntil(
      fixture,
      () => host(fixture).querySelector('[data-testid="insights-breakdown"]') !== null
    );
    return fixture;
  }

  it('shows the shared panel skeleton on the cold path', () => {
    // The block is normally rendered with the TanStack cache already warm from
    // `InsightsPanelComponent`, so this branch is the one a user reaches by clicking the
    // button before scrolling. It is written and tested for that reason.
    configure([postOfLength(10)]);
    const fixture = TestBed.createComponent(InsightsBreakdownComponent);
    fixture.detectChanges();

    expect(host(fixture).querySelector('[data-testid="panel-skeleton"]')).not.toBeNull();
  });

  it('renders one row per band with counts and shares', async () => {
    const fixture = await render([postOfLength(10), postOfLength(300)]);

    const rows = Array.from(host(fixture).querySelectorAll('[data-testid="band-row"]'));
    expect(rows.length).toBe(4);
    expect(rows[0].textContent).toContain('50%');
    expect(rows[3].textContent).toContain('0%');
  });
});
