import { ChangeDetectionStrategy, Component, signal } from '@angular/core';

/** One entry in the "what's new" strip. */
export interface ReleaseNote {
  readonly version: string;
  readonly date: string;
  readonly summary: string;
}

/**
 * The entries the strip shows, newest first.
 *
 * Static, like `SAMPLE_WIDGETS`: this is the file a consumer deletes and replaces with a
 * feed of their own, and a boilerplate whose dashboard needs a changelog service to render
 * anything is a worse starting point than one that renders immediately. Swapping the
 * constant for a `resource()` changes this file and nothing else.
 */
const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    version: '2026.9',
    date: '2026-09-02',
    summary: 'Deferred dashboard sections load on scroll instead of on navigation.',
  },
  {
    version: '2026.8',
    date: '2026-08-14',
    summary: 'Widgets can be collapsed individually and expanded together.',
  },
  {
    version: '2026.7',
    date: '2026-07-29',
    summary: 'Post search cancels superseded requests instead of racing them.',
  },
];

/**
 * A dismissible "what's new" strip.
 *
 * ## Why this is the one block on a timer
 *
 * `on timer(4s)` is rarely the right trigger, and the reason is worth stating where the one
 * use of it lives: a timer starts when the block is rendered and fires regardless of what
 * the user is doing, so it will happily contend with a page that is still settling. `on
 * idle` — the default — waits for the main thread to be quiet, which is what people usually
 * mean when they reach for a delay.
 *
 * What makes the timer right *here* is that the delay is the feature rather than a proxy
 * for one. This strip is an interruption: it is not what the user came to the dashboard for,
 * and appearing during the first paint would put it under a cursor already moving toward
 * something else. Four seconds is long enough that the dashboard is read first and short
 * enough that the strip is not mistaken for a late-loading failure. `prefetch on idle`
 * takes the download off that clock, so the timer decides only when it is *shown*.
 *
 * There is deliberately no `@placeholder`: reserving four seconds of empty space for a
 * notice most sessions dismiss would be worse than the shift of it arriving. That is the
 * trade a placeholder always makes — a stable layout in exchange for space the content may
 * never fill — and it is only worth it when the content is what the user is waiting for.
 *
 * @see [`docs/defer.md`](../../../../../docs/defer.md)
 */
@Component({
  selector: 'app-release-notes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!dismissed()) {
      <aside
        class="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-muted)] p-4"
        aria-labelledby="release-notes-heading"
        data-testid="release-notes"
      >
        <div class="flex items-start justify-between gap-3">
          <h3 id="release-notes-heading" class="text-sm font-medium text-[var(--color-foreground)]">
            What's new
          </h3>
          <button
            type="button"
            class="text-xs font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            data-testid="dismiss-release-notes"
            (click)="dismissed.set(true)"
          >
            Dismiss
          </button>
        </div>

        <ul class="mt-3 space-y-2">
          @for (note of notes; track note.version) {
            <li class="text-xs text-[var(--color-muted-foreground)]">
              <span class="font-medium text-[var(--color-foreground)]">{{ note.version }}</span>
              <time class="ml-2">{{ note.date }}</time>
              <p class="mt-1">{{ note.summary }}</p>
            </li>
          }
        </ul>
      </aside>
    }
  `,
})
export class ReleaseNotesComponent {
  protected readonly notes = RELEASE_NOTES;

  /**
   * Dismissal is per-render and deliberately not persisted.
   *
   * Remembering it would mean a store, and a store read in a deferred block is a read that
   * happens four seconds after the page settled — the wrong place for anything the rest of
   * the application depends on. A consumer wiring this to a real feed should hoist the
   * decision to the host, where `@defer (when shouldShow())` can keep the block from
   * loading at all.
   */
  protected readonly dismissed = signal(false);
}
