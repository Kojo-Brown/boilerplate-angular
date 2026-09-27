import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';

/**
 * One thing worth saying out loud, and which saying it this is.
 *
 * The `id` is not decoration and not a debugging aid. A live region is announced when its
 * contents **change**, so writing `'Posts'` into a region that already reads `'Posts'` is
 * not a quiet no-op — it is not an event at all, and a visitor moving between two routes
 * that share a title hears nothing. Carrying an identity makes "the same text again" a
 * different value, so it survives `input()`'s equality check and reaches the region; the
 * clear-then-write in {@link LiveRegionComponent} is what then makes the DOM agree.
 *
 * Build these with {@link announcement} rather than by hand, so the ids stay unique.
 */
export interface Announcement {
  readonly text: string;
  readonly id: number;
}

let nextAnnouncementId = 0;

/** Wrap `text` as a distinct {@link Announcement}, distinct even from an identical one. */
export function announcement(text: string): Announcement {
  return { text, id: nextAnnouncementId++ };
}

/**
 * How long the region is left empty between a clear and the message that follows it.
 *
 * Two writes inside one change-detection cycle render once, so clearing and writing have
 * to land in different frames or the DOM never shows the empty state that makes the
 * second write a change. 100 ms is `LiveAnnouncer`'s own figure: longer than a frame,
 * shorter than a person notices.
 */
const CLEAR_TO_ANNOUNCE_MS = 100;

/**
 * A single ARIA live region, rendered where it is declared and populated later.
 *
 * Almost every way a live region fails is a matter of timing or of the accessibility
 * tree, and none of them is visible on screen. The three this component exists to get
 * right:
 *
 * **The region has to exist before it has anything to say.** A screen reader registers a
 * live region as it enters the accessibility tree and watches it from then on. An element
 * created and populated in the same task is, to the reader, a region that has always
 * contained that text, and it announces nothing. So the element lives in a template that
 * renders at bootstrap — present and empty from the first paint — and announcements only
 * ever mutate it. This is the reason `RouteAnnouncerComponent` is in `AppComponent`'s
 * template rather than being a service that appends a `<div>` on first use.
 *
 * **It has to be hidden without being hidden.** `display: none`, `visibility: hidden`,
 * the `hidden` attribute and `aria-hidden` all remove the element from the accessibility
 * tree — which is the tree the announcement is read from, so each of them makes the
 * region invisible in the way that also means silent. Tailwind's `sr-only` is the
 * clip-rect pattern precisely because it leaves the element rendered and exposed.
 *
 * **Repeating itself has to be possible.** See {@link Announcement} and
 * {@link CLEAR_TO_ANNOUNCE_MS}: the identity gets the repeat past `input()`, the clear
 * gets it past the DOM.
 *
 * `aria-atomic="true"` makes the reader speak the whole region rather than the part that
 * changed. With atomic off, `'Post 41'` becoming `'Post 42'` can be announced as `'42'` —
 * correct, useless, and a difference no visual check would ever show.
 *
 * On the server this renders the empty region and stops: `announcement` is only ever set
 * by browser-side code, so the effect below never schedules a timer. That is the right
 * artifact to prerender — the region is in the HTML, registered, before hydration.
 */
@Component({
  selector: 'app-live-region',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sr-only" [attr.aria-live]="politeness()" aria-atomic="true">{{ rendered() }}</div>
  `,
})
export class LiveRegionComponent {
  /** The message to announce, or `null` for a region that has nothing to say yet. */
  readonly announcement = input<Announcement | null>(null);

  /**
   * `polite` waits for the reader to finish its sentence; `assertive` interrupts it.
   *
   * Assertive is for something that invalidates what the visitor is being told right now —
   * a session expiring under them, a destructive action completing. A route change is not
   * one: interrupting to say the page has changed talks over the content they asked for,
   * which is why `RouteAnnouncerComponent` is polite.
   */
  readonly politeness = input<'polite' | 'assertive'>('polite');

  /** What the region actually contains, which lags {@link announcement} by one clear. */
  protected readonly rendered = signal('');

  private pending: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.pending));

    effect(() => {
      const next = this.announcement();

      // Supersede rather than queue. If two announcements arrive inside the clear window
      // the second is the current state of the application and the first describes a page
      // the visitor has already left; speaking both in order would report the navigation
      // they abandoned as though it had happened.
      clearTimeout(this.pending);
      this.rendered.set('');

      if (next === null || next.text === '') return;

      this.pending = setTimeout(() => {
        this.rendered.set(next.text);
        this.pending = undefined;
      }, CLEAR_TO_ANNOUNCE_MS);
    });
  }
}
