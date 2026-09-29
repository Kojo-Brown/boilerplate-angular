import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { injectPluralSelector } from '@/app/core/i18n';
import { typeahead } from '@/app/core/reactivity';
import { PostSearcher } from './posts.contracts';
import type { Post } from './posts.models';

let nextId = 0;

const INPUT_CLASSES =
  'w-full rounded-[var(--radius)] border border-[var(--color-border)] px-3 py-2 text-sm ' +
  'bg-[var(--color-background)] text-[var(--color-foreground)] ' +
  'placeholder:text-[var(--color-muted-foreground)] ' +
  'transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]';

const OPTION_CLASSES = 'cursor-pointer px-3 py-2 text-sm';
const ACTIVE_OPTION_CLASSES = `${OPTION_CLASSES} bg-[var(--color-muted)]`;

/**
 * Search-as-you-type over posts: the demo the flattening guide hangs off, and the one
 * production caller of [`typeahead`](../../core/reactivity/typeahead.ts).
 *
 * The RxJS is all in the primitive. What is left here is the part a search box gets wrong
 * even when its stream is right:
 *
 * - **The listbox is keyboard-operable.** ARIA's combobox pattern moves a *virtual* focus:
 *   DOM focus stays in the input — so typing keeps working — and `aria-activedescendant`
 *   points at the option a screen reader should announce. Arrow keys wrap, `Enter` opens
 *   the active option, `Escape` closes the list without clearing the query.
 * - **Options commit on `mousedown`, not `click`.** `blur` fires between the two, and
 *   closing the list on blur would unmount the option before its `click` ever arrived.
 * - **The status line is a live region**, because "3 results" appearing in a list nobody
 *   is looking at is not an announcement.
 */
@Component({
  selector: 'app-post-typeahead',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The host is the positioning context for the absolutely positioned listbox, so it has
  // to be a block: an inline host collapses and the dropdown anchors to the page instead.
  host: { class: 'block' },
  template: `
    <div class="relative">
      <label [for]="inputId" i18n="@@posts.typeahead.label" class="sr-only">Search posts</label>
      <input
        [id]="inputId"
        type="search"
        role="combobox"
        autocomplete="off"
        i18n-placeholder="@@posts.typeahead.placeholder"
        placeholder="Search posts…"
        aria-autocomplete="list"
        [attr.aria-expanded]="isOpen()"
        [attr.aria-controls]="listboxId"
        [attr.aria-activedescendant]="activeOptionId()"
        [value]="query()"
        (input)="onInput($event)"
        (keydown)="onKeydown($event)"
        (focus)="dismissed.set(false)"
        (blur)="dismissed.set(true)"
        [class]="inputClasses"
      />

      @if (isOpen()) {
        <ul
          [id]="listboxId"
          role="listbox"
          i18n-aria-label="@@posts.typeahead.listboxLabel"
          aria-label="Post search results"
          class="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-background)] py-1 shadow-lg"
        >
          @for (post of search.results(); track post.id; let i = $index) {
            <li
              [id]="optionId(i)"
              role="option"
              [attr.aria-selected]="i === activeIndex()"
              (mousedown)="select(post)"
              (mouseenter)="activeIndex.set(i)"
              [class]="i === activeIndex() ? activeOptionClasses : optionClasses"
            >
              <p class="truncate font-medium text-[var(--color-foreground)]">{{ post.title }}</p>
              <p class="truncate text-xs text-[var(--color-muted-foreground)]">{{ post.body }}</p>
            </li>
          } @empty {
            <li class="px-3 py-2 text-sm text-[var(--color-muted-foreground)]">
              {{ emptyMessage() }}
            </li>
          }
        </ul>
      }

      <p role="status" aria-live="polite" class="sr-only">{{ statusMessage() }}</p>
    </div>
  `,
})
export class PostTypeaheadComponent {
  private readonly router = inject(Router);
  // A search box searches. Injecting the narrow role means a spec can stand in
  // `{ search: () => of([]) }` rather than a stub of the whole posts API.
  private readonly posts = inject(PostSearcher);
  private readonly plural = injectPluralSelector();

  private readonly id = nextId++;
  protected readonly inputId = `post-typeahead-${this.id}`;
  protected readonly listboxId = `post-typeahead-listbox-${this.id}`;
  protected readonly inputClasses = INPUT_CLASSES;
  protected readonly optionClasses = OPTION_CLASSES;
  protected readonly activeOptionClasses = ACTIVE_OPTION_CLASSES;

  protected readonly query = signal('');
  protected readonly search = typeahead<Post>(this.query, (term) => this.posts.search(term));

  /** Index of the virtually focused option, or -1 for "the input itself". */
  protected readonly activeIndex = signal(-1);
  /** Set by `Escape` and by blur; cleared by the next keystroke or focus. */
  protected readonly dismissed = signal(false);

  protected readonly isOpen = computed(() => !this.dismissed() && this.search.status() !== 'idle');

  protected readonly activeOptionId = computed(() => {
    const index = this.activeIndex();
    return this.isOpen() && index >= 0 ? this.optionId(index) : null;
  });

  protected readonly emptyMessage = computed(() =>
    this.search.status() === 'error'
      ? $localize`:Shown in the results list when the search request failed@@posts.typeahead.empty.error:Search failed. Try again.`
      : this.search.status() === 'searching'
        ? $localize`:Shown in the results list while a search is in flight@@posts.typeahead.empty.searching:Searching…`
        : $localize`:Shown in the results list when a search returned nothing@@posts.typeahead.empty.none:No posts match “${this.search.term()}:term:”.`
  );

  /**
   * Deliberately silent while `searching`: a spinner's worth of chatter on every
   * keystroke drowns the result count that actually matters.
   */
  protected readonly statusMessage = computed(() => {
    if (!this.isOpen()) return '';
    switch (this.search.status()) {
      case 'ready': {
        const count = this.search.results().length;
        const term = this.search.term();
        // Announced, not rendered, so there is no template to put an ICU in — the
        // selection has to happen here. See `core/i18n/plural.ts`.
        return count === 0
          ? $localize`:Announced to a screen reader when a search returns nothing@@posts.typeahead.status.none:No posts match ${term}:term:.`
          : this.plural(count, {
              zero: $localize`:Announced result count; zero@@posts.typeahead.status.zero:${count}:count: posts match ${term}:term:.`,
              one: $localize`:Announced result count; one@@posts.typeahead.status.one:${count}:count: post matches ${term}:term:.`,
              two: $localize`:Announced result count; two@@posts.typeahead.status.two:${count}:count: posts match ${term}:term:.`,
              few: $localize`:Announced result count; a small number@@posts.typeahead.status.few:${count}:count: posts match ${term}:term:.`,
              many: $localize`:Announced result count; a large number@@posts.typeahead.status.many:${count}:count: posts match ${term}:term:.`,
              other: $localize`:Announced result count@@posts.typeahead.status.other:${count}:count: posts match ${term}:term:.`,
            });
      }
      case 'error':
        return $localize`:Announced to a screen reader when the search request failed@@posts.typeahead.status.error:Post search failed.`;
      default:
        return '';
    }
  });

  protected optionId(index: number): string {
    return `${this.listboxId}-option-${index}`;
  }

  protected onInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.activeIndex.set(-1);
    this.dismissed.set(false);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const count = this.search.results().length;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.dismissed.set(false);
        if (count > 0) this.activeIndex.set((this.activeIndex() + 1) % count);
        break;

      case 'ArrowUp':
        event.preventDefault();
        this.dismissed.set(false);
        if (count > 0) this.activeIndex.set((this.activeIndex() - 1 + count) % count);
        break;

      case 'Enter': {
        const active = this.search.results()[this.activeIndex()];
        if (active !== undefined) {
          // Only when an option is virtually focused: otherwise Enter belongs to whatever
          // form the box is sitting in.
          event.preventDefault();
          this.select(active);
        }
        break;
      }

      case 'Escape':
        // The query survives, so a mis-dismissal costs a keystroke and not the search.
        this.dismissed.set(true);
        this.activeIndex.set(-1);
        break;

      default:
        break;
    }
  }

  protected select(post: Post): void {
    this.query.set('');
    this.activeIndex.set(-1);
    this.dismissed.set(true);
    void this.router.navigate(['/dashboard/posts', post.id]);
  }
}
