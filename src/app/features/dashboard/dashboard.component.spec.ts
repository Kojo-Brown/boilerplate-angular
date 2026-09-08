import {
  DeferBlockBehavior,
  DeferBlockState,
  TestBed,
  fakeAsync,
  tick,
} from '@angular/core/testing';
import type { ComponentFixture, DeferBlockFixture } from '@angular/core/testing';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { host, requireEl } from '@/testing';
import { InMemoryPostsService } from '../posts/in-memory-posts.service';
import { providePostsBackend } from '../posts/posts.providers';
import { DashboardComponent } from './dashboard.component';
import { provideDashboardWidgets } from './widgets/widget.contracts';

/**
 * The blocks in template order, which is the order `getDeferBlocks()` returns them in and
 * the only handle a spec has on them — a `@defer` block has no name.
 */
const PANEL = 0;
const BREAKDOWN = 1;
const RELEASE_NOTES = 2;

describe('DashboardComponent', () => {
  function create(
    deferBlockBehavior = DeferBlockBehavior.Playthrough
  ): ComponentFixture<DashboardComponent> {
    TestBed.configureTestingModule({
      imports: [DashboardComponent],
      deferBlockBehavior,
      providers: [
        provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
        ...providePostsBackend(InMemoryPostsService),
        // The board is not what these specs are about, and an empty registry renders a
        // board with no panels rather than pulling three widgets into every fixture.
        provideDashboardWidgets(),
      ],
    });
    const fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();
    return fixture;
  }

  describe('with triggers under the spec’s control', () => {
    /** A manual-mode fixture and its three blocks, which is what every case below needs. */
    async function manual(): Promise<{
      fixture: ComponentFixture<DashboardComponent>;
      blocks: DeferBlockFixture[];
    }> {
      const fixture = create(DeferBlockBehavior.Manual);
      return { fixture, blocks: await fixture.getDeferBlocks() };
    }

    it('declares exactly the three deferred sections', async () => {
      // A fourth block, or a block deleted, shifts the indices every assertion below
      // depends on — so it fails here, once, with a readable message.
      const { blocks } = await manual();

      expect(blocks.length).toBe(3);
    });

    it('draws the shared skeleton as the insights placeholder', async () => {
      const { fixture, blocks } = await manual();
      await blocks[PANEL].render(DeferBlockState.Placeholder);

      const skeleton = requireEl<HTMLElement>(host(fixture), '[data-testid="panel-skeleton"]');
      expect(skeleton.textContent).toContain('Loading publishing activity');
    });

    it('renders the insights panel when the block completes', async () => {
      const { fixture, blocks } = await manual();
      await blocks[PANEL].render(DeferBlockState.Complete);

      expect(host(fixture).querySelector('app-insights-panel')).not.toBeNull();
    });

    it('offers a reload rather than a retry when a block fails', async () => {
      // `@error` is terminal: Angular has no API to re-run a failed defer block, so a
      // "Try again" button here would be a button that does nothing. The message says
      // reload because reload is what actually works.
      const { fixture, blocks } = await manual();
      await blocks[PANEL].render(DeferBlockState.Error);

      const error = requireEl<HTMLElement>(host(fixture), '[data-testid="insights-panel-error"]');
      expect(error.textContent).toContain('Reload');
    });

    it('draws a matching skeleton while the breakdown chunk is in flight', async () => {
      const { fixture, blocks } = await manual();
      await blocks[BREAKDOWN].render(DeferBlockState.Loading);

      expect(host(fixture).querySelector('[data-testid="panel-skeleton"]')).not.toBeNull();
    });

    it('renders the release notes when its block completes', async () => {
      const { fixture, blocks } = await manual();
      await blocks[RELEASE_NOTES].render(DeferBlockState.Complete);

      expect(host(fixture).querySelector('[data-testid="release-notes"]')).not.toBeNull();
    });

    it('leaves the panel placeholder as a single root element for the viewport trigger', async () => {
      // `on viewport` with no explicit reference observes the placeholder's one root
      // element, and Angular throws at runtime if there is not exactly one. Nothing in a
      // build or a lint pass checks it, and the failure only happens on a device slow
      // enough for the placeholder to be reached at all.
      const { fixture, blocks } = await manual();
      await blocks[PANEL].render(DeferBlockState.Placeholder);

      const skeletons = host(fixture).querySelectorAll('app-panel-skeleton');
      expect(skeletons.length).toBe(1);
      const roots = Array.from(skeletons[0].childNodes).filter(
        (node) => node.nodeType === Node.ELEMENT_NODE
      );
      expect(roots.length).toBe(1);
    });
  });

  describe('with the real triggers', () => {
    it('does not render the breakdown until its trigger is used', () => {
      const fixture = create();

      expect(host(fixture).querySelector('app-insights-breakdown')).toBeNull();
    });

    it('loads the breakdown when the button outside the block is clicked', async () => {
      const fixture = create();

      requireEl<HTMLButtonElement>(host(fixture), '[data-testid="show-breakdown"]').click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(host(fixture).querySelector('app-insights-breakdown')).not.toBeNull();
    });

    it('keeps the trigger button in the document once the block has loaded', async () => {
      // The button is outside the block precisely so that clicking it does not destroy
      // it: a trigger inside a `@placeholder` is replaced by the loaded content, and a
      // keyboard user who activated it is left with no focused element.
      const fixture = create();
      const button = requireEl<HTMLButtonElement>(host(fixture), '[data-testid="show-breakdown"]');

      button.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(host(fixture).contains(button)).toBe(true);
    });

    it('shows the release notes only after the timer elapses', fakeAsync(() => {
      const fixture = create();

      tick(3_000);
      fixture.detectChanges();
      expect(host(fixture).querySelector('[data-testid="release-notes"]')).toBeNull();

      // The trigger fires at 4s; the chunk then resolves on the microtask queue, which
      // the second `tick` drains.
      tick(1_000);
      tick(0);
      fixture.detectChanges();

      expect(host(fixture).querySelector('[data-testid="release-notes"]')).not.toBeNull();
    }));
  });
});
