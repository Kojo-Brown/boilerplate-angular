import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { host, requireEl, settleUntil } from '@/testing';
import { createMockPost } from '@/testing/mock-factories';
import { IN_MEMORY_POSTS_SEED, InMemoryPostsService } from '../../posts/in-memory-posts.service';
import type { Post } from '../../posts/posts.models';
import { providePostsBackend } from '../../posts/posts.providers';
import { InsightsPanelComponent, tallyByAuthor } from './insights-panel.component';

function post(authorId: string, overrides: Partial<Post> = {}): Post {
  return createMockPost({ authorId, ...overrides });
}

describe('tallyByAuthor', () => {
  it('counts posts per author, busiest first', () => {
    const tallies = tallyByAuthor([
      post('ama'),
      post('kofi'),
      post('ama'),
      post('ama'),
      post('kofi'),
    ]);

    expect(tallies.map((t) => [t.authorId, t.posts])).toEqual([
      ['ama', 3],
      ['kofi', 2],
    ]);
  });

  it('breaks ties by author id so the order does not depend on insertion', () => {
    // Without the tie-break the rows would follow `Map` insertion order, and a page of
    // posts arriving in a different order would silently reshuffle a chart that should
    // look the same.
    const tallies = tallyByAuthor([post('yaa'), post('ama'), post('kwesi')]);

    expect(tallies.map((t) => t.authorId)).toEqual(['ama', 'kwesi', 'yaa']);
  });

  it('measures each share against the busiest author, not the total', () => {
    const tallies = tallyByAuthor([post('ama'), post('ama'), post('ama'), post('kofi')]);

    expect(tallies[0].share).toBe(1);
    expect(tallies[1].share).toBeCloseTo(1 / 3, 10);
  });

  it('keeps at most five authors', () => {
    const posts = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => post(id));

    expect(tallyByAuthor(posts).length).toBe(5);
  });

  it('returns nothing for an empty page rather than dividing by zero', () => {
    // The brand-new-account path. A `NaN` share would reach the template as a bar of
    // width `NaN%`, which renders as a full-width bar in some browsers and none in others.
    expect(tallyByAuthor([])).toEqual([]);
  });
});

describe('InsightsPanelComponent', () => {
  function configure(seed: readonly Post[]): void {
    TestBed.configureTestingModule({
      imports: [InsightsPanelComponent],
      providers: [
        provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
        ...providePostsBackend(InMemoryPostsService),
        { provide: IN_MEMORY_POSTS_SEED, useValue: seed },
      ],
    });
  }

  async function render(seed: readonly Post[]): Promise<ComponentFixture<InsightsPanelComponent>> {
    configure(seed);
    const fixture = TestBed.createComponent(InsightsPanelComponent);
    fixture.detectChanges();
    await settleUntil(
      fixture,
      () => host(fixture).querySelector('[data-testid="insights-panel"]') !== null
    );
    return fixture;
  }

  it('shows the shared panel skeleton while the query is pending', () => {
    // The same component the host renders as the `@defer` placeholder. Asserted here
    // because it is the whole reason the skeleton is a component: if this branch drew its
    // own markup instead, the frame would change shape at the moment the chunk landed.
    configure([post('ama')]);
    const fixture = TestBed.createComponent(InsightsPanelComponent);
    fixture.detectChanges();

    expect(host(fixture).querySelector('[data-testid="panel-skeleton"]')).not.toBeNull();
    expect(host(fixture).querySelector('[data-testid="insights-panel"]')).toBeNull();
  });

  it('draws one bar per author once the query resolves', async () => {
    const fixture = await render([post('ama'), post('ama'), post('kofi')]);

    const bars = host(fixture).querySelectorAll('[data-testid="author-bar"]');
    expect(bars.length).toBe(2);
    expect(host(fixture).querySelector('[data-testid="panel-skeleton"]')).toBeNull();
  });

  it('sizes each bar by the author share', async () => {
    const fixture = await render([post('ama'), post('ama'), post('kofi')]);

    const bars = Array.from(
      host(fixture).querySelectorAll<HTMLElement>('[data-testid="author-bar"]')
    );
    expect(bars[0].style.width).toBe('100%');
    expect(bars[1].style.width).toBe('50%');
  });

  it('reports the total from the page rather than from the rows it drew', async () => {
    // The chart is capped at five authors; the count in the header is every post the
    // backend reported, so the two numbers are deliberately allowed to disagree.
    const seed = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => post(id));
    const fixture = await render(seed);

    expect(requireEl<HTMLElement>(host(fixture), 'header p').textContent).toContain('6 posts');
    expect(host(fixture).querySelectorAll('[data-testid="author-bar"]').length).toBe(5);
  });

  it('says so when there are no posts instead of drawing an empty chart', async () => {
    const fixture = await render([]);

    expect(host(fixture).querySelector('[data-testid="insights-empty"]')).not.toBeNull();
    expect(host(fixture).querySelectorAll('[data-testid="author-bar"]').length).toBe(0);
  });
});
