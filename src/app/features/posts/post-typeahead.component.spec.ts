import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import type { TestRequest } from '@angular/common/http/testing';
import { environment } from '@/environments/environment';
import { createMockPost, fillInput, host, requireEl } from '@/testing';
import { PostTypeaheadComponent } from './post-typeahead.component';
import { PostsService } from './posts.service';
import type { PaginatedResponse } from '@/app/core/http/models/api.models';
import type { PostSearcher } from './posts.contracts';
import type { Post } from './posts.models';

const BASE = `${environment.apiUrl}/posts`;
/** The primitive's default, which the component does not override. */
const DEBOUNCE = 300;

function pageOf(posts: Post[]): PaginatedResponse<Post> {
  return { data: posts, total: posts.length, page: 1, pageSize: 10, totalPages: 1 };
}

describe('PostTypeaheadComponent', () => {
  let httpTesting: HttpTestingController;
  let fixture: ComponentFixture<PostTypeaheadComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PostTypeaheadComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    httpTesting = TestBed.inject(HttpTestingController);
  });

  /**
   * Construct inside the spec body, never in a plain `beforeEach`.
   *
   * The component builds its pipeline in its field initialisers, so the `toObservable`
   * effect and every timer `debounceTime` goes on to arm belong to whatever zone
   * constructed it. A fixture created outside `fakeAsync` schedules them on the real
   * clock, where `tick()` cannot reach them and no request is ever issued — a spec that
   * asserts "no request yet" then passes for the wrong reason.
   */
  function create(): void {
    fixture = TestBed.createComponent(PostTypeaheadComponent);
    fixture.detectChanges();
  }

  /** Type into the box and let the debounce elapse. */
  function search(term: string): void {
    fillInput(host(fixture), 'input', term);
    fixture.detectChanges();
    tick(DEBOUNCE);
  }

  function expectSearchFor(term: string): TestRequest {
    return httpTesting.expectOne((r) => r.url === BASE && r.params.get('search') === term);
  }

  function settle(term: string, posts: Post[]): void {
    expectSearchFor(term).flush(pageOf(posts));
    fixture.detectChanges();
  }

  function options(): HTMLElement[] {
    return Array.from(host(fixture).querySelectorAll<HTMLElement>('[role="option"]'));
  }

  function input(): HTMLInputElement {
    return requireEl<HTMLInputElement>(host(fixture), 'input');
  }

  function press(key: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, cancelable: true });
    input().dispatchEvent(event);
    fixture.detectChanges();
    return event;
  }

  it('renders a collapsed combobox with no listbox', () => {
    create();

    expect(input().getAttribute('role')).toBe('combobox');
    expect(input().getAttribute('aria-expanded')).toBe('false');
    expect(input().getAttribute('aria-autocomplete')).toBe('list');
    expect(host(fixture).querySelector('[role="listbox"]')).toBeNull();
    httpTesting.verify();
  });

  it('points aria-controls at the listbox it opens', fakeAsync(() => {
    create();
    search('signals');
    settle('signals', [createMockPost()]);

    const listbox = requireEl<HTMLElement>(host(fixture), '[role="listbox"]');
    expect(input().getAttribute('aria-controls')).toBe(listbox.id);
    expect(input().getAttribute('aria-expanded')).toBe('true');
  }));

  it('waits out the debounce before issuing a request', fakeAsync(() => {
    create();
    fillInput(host(fixture), 'input', 'signals');
    fixture.detectChanges();

    tick(DEBOUNCE - 1);
    httpTesting.expectNone(() => true);

    tick(1);
    settle('signals', []);
  }));

  it('renders one option per matching post', fakeAsync(() => {
    create();
    search('signals');
    settle('signals', [
      createMockPost({ id: '1', title: 'Signals in depth' }),
      createMockPost({ id: '2', title: 'Signal-based forms' }),
    ]);

    expect(options().map((el) => requireEl(el, 'p').textContent?.trim())).toEqual([
      'Signals in depth',
      'Signal-based forms',
    ]);
  }));

  // `switchMap`'s contract, asserted against the real HTTP layer rather than a stub: the
  // superseded request is not merely ignored, it is aborted.
  it('cancels the superseded request when the term moves on', fakeAsync(() => {
    create();
    search('sig');
    const first = expectSearchFor('sig');

    search('signals');

    expect(first.cancelled).toBeTrue();
    settle('signals', []);
  }));

  it('announces the result count in a live region', fakeAsync(() => {
    create();
    search('signals');
    settle('signals', [createMockPost(), createMockPost()]);

    const status = requireEl<HTMLElement>(host(fixture), '[role="status"]');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent?.trim()).toBe('2 posts match signals.');
  }));

  it('says so when nothing matches', fakeAsync(() => {
    create();
    search('signals');
    settle('signals', []);

    expect(host(fixture).textContent).toContain('No posts match');
    expect(options()).toEqual([]);
  }));

  it('reports a failed search without closing the box', fakeAsync(() => {
    create();
    search('signals');
    expectSearchFor('signals').flush('nope', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(host(fixture).textContent).toContain('Search failed');

    // Still live: the next term searches normally.
    search('forms');
    settle('forms', [createMockPost({ title: 'Typed forms' })]);
    expect(options().length).toBe(1);
  }));

  it('issues no request for a term below the minimum length', fakeAsync(() => {
    create();
    search('s');

    httpTesting.expectNone(() => true);
    expect(host(fixture).querySelector('[role="listbox"]')).toBeNull();
  }));

  describe('keyboard', () => {
    function createWithResults(): void {
      create();
      search('signals');
      settle('signals', [
        createMockPost({ id: '1', title: 'First' }),
        createMockPost({ id: '2', title: 'Second' }),
      ]);
    }

    it('moves a virtual focus with ArrowDown, leaving DOM focus in the input', fakeAsync(() => {
      createWithResults();
      press('ArrowDown');

      expect(input().getAttribute('aria-activedescendant')).toBe(options()[0].id);
      expect(options()[0].getAttribute('aria-selected')).toBe('true');
      expect(options()[1].getAttribute('aria-selected')).toBe('false');
      expect(document.activeElement).not.toBe(options()[0]);
    }));

    it('wraps past the last option and before the first', fakeAsync(() => {
      createWithResults();

      press('ArrowDown');
      press('ArrowDown');
      press('ArrowDown');
      expect(input().getAttribute('aria-activedescendant')).toBe(options()[0].id);

      press('ArrowUp');
      expect(input().getAttribute('aria-activedescendant')).toBe(options()[1].id);
    }));

    it('claims ArrowDown from the caret', fakeAsync(() => {
      createWithResults();
      expect(press('ArrowDown').defaultPrevented).toBeTrue();
    }));

    it('opens the active option on Enter and clears the box', fakeAsync(() => {
      createWithResults();
      const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);

      press('ArrowDown');
      const enter = press('Enter');

      expect(navigate).toHaveBeenCalledOnceWith(['/dashboard/posts', '1']);
      expect(enter.defaultPrevented).toBeTrue();
      expect(input().value).toBe('');
      expect(host(fixture).querySelector('[role="listbox"]')).toBeNull();
    }));

    // Enter with nothing active belongs to whatever form the box is sitting in.
    it('leaves Enter alone while no option is active', fakeAsync(() => {
      createWithResults();
      const navigate = spyOn(TestBed.inject(Router), 'navigate');

      const enter = press('Enter');

      expect(navigate).not.toHaveBeenCalled();
      expect(enter.defaultPrevented).toBeFalse();
    }));

    it('closes on Escape but keeps the query', fakeAsync(() => {
      createWithResults();
      press('Escape');

      expect(host(fixture).querySelector('[role="listbox"]')).toBeNull();
      expect(input().value).toBe('signals');
      expect(input().getAttribute('aria-activedescendant')).toBeNull();
    }));

    it('reopens on the next keystroke after Escape', fakeAsync(() => {
      createWithResults();
      press('Escape');

      search('signals!');
      settle('signals!', [createMockPost({ title: 'Bang' })]);

      expect(options().length).toBe(1);
    }));
  });

  it('opens the option that was pressed', fakeAsync(() => {
    create();
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);

    search('signals');
    settle('signals', [createMockPost({ id: '7', title: 'Seventh' })]);

    // `mousedown`, not `click`: `blur` lands between them and unmounts the list.
    options()[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    fixture.detectChanges();

    expect(navigate).toHaveBeenCalledOnceWith(['/dashboard/posts', '7']);
    expect(input().value).toBe('');
  }));

  it('aborts the open request when the component is destroyed', fakeAsync(() => {
    create();
    search('signals');
    const request = expectSearchFor('signals');

    fixture.destroy();

    expect(request.cancelled).toBeTrue();
  }));

  /**
   * The interface-segregation payoff, stated as a test: what this component needs from
   * `PostsService` is one method. If that ever stops being true, this spec fails to
   * compile — which is a better warning than a component quietly growing a dependency
   * on the writing side of the posts API.
   */
  it('needs nothing from PostsService beyond PostSearcher', fakeAsync(() => {
    const searcher: PostSearcher = {
      search: (query) => of([createMockPost({ id: '1', title: `Result for ${query}` })]),
    };
    // A fresh module rather than `overrideProvider`: the shared `beforeEach` has already
    // injected `HttpTestingController`, and an instantiated TestBed refuses overrides.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [PostTypeaheadComponent],
      providers: [provideRouter([]), { provide: PostsService, useValue: searcher }],
    });

    create();
    search('signals');
    fixture.detectChanges();

    expect(options().length).toBe(1);
    expect(options()[0].textContent).toContain('Result for signals');
  }));
});
