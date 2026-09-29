import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  Input,
  PLATFORM_ID,
  computed,
  inject,
  linkedSignal,
} from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { mediaQuerySignal } from '@/app/core/reactivity';
import { BrandMarkComponent } from '../brand/brand-mark.component';
import { ThemeToggleComponent } from '../theme-toggle/theme-toggle.component';
import { RouteFocusTargetDirective } from '@/app/core/a11y';

/** Matches Tailwind's `md` breakpoint, where the drawer becomes a static sidebar. */
const DESKTOP_QUERY = '(min-width: 768px)';

/**
 * The drawer/sidebar frame, in logical properties.
 *
 * `start-0` and `border-e` rather than `left-0` and `border-r`: the localised build sets
 * `dir="rtl"` on `<html>` for Arabic (Angular does it, not this application), and
 * `dir` alone moves nothing — a sidebar pinned to `left` stays on the left of an
 * interface whose reading order now starts on the right, with its border on the inside
 * edge. The logical pair resolves against the document's direction, so one class name
 * covers both.
 *
 * `translate-x` has no logical form, which is why {@link SIDEBAR_CLOSED} below is the
 * one place that names a direction explicitly.
 */
const SIDEBAR_BASE =
  'fixed inset-y-0 start-0 z-40 flex w-64 flex-col ' +
  'border-e border-[var(--color-border)] bg-[var(--color-background)] ' +
  'transition-transform duration-200 ease-in-out md:static md:translate-x-0';

/**
 * Where the closed drawer sits: off screen, past the edge the reading direction starts at.
 *
 * All three parts are load-bearing. A transform is a geometric operation and has no
 * notion of writing direction, so `-translate-x-full` moves the panel left whatever `dir`
 * says — and in an RTL document the panel is anchored to the *right* edge, so translating
 * it left slides it across the page rather than off it: the closed drawer covers the
 * content, `inert` and all. `rtl:` is Tailwind's built-in direction variant, compiled to
 * `:where([dir="rtl"] &)`, so the sign follows the same attribute `start-0` does.
 *
 * `max-md:` is the part that is easy to leave off and was, for one measurement. Above the
 * breakpoint this element is not a drawer at all — it is the static sidebar, held in place
 * by `md:translate-x-0` in {@link SIDEBAR_BASE}, which used to win over a bare
 * `-translate-x-full` only because Tailwind emits breakpoint variants after unprefixed
 * utilities. `rtl:translate-x-full` is emitted after `md:translate-x-0`, and both are one
 * class of specificity, so adding it pushed the *desktop* sidebar off the right-hand edge
 * of every RTL page — a layout with no navigation on it, passing every other gate.
 * Scoping the closed state to below the breakpoint says what was always meant: the panel
 * only slides where it is a drawer.
 */
const SIDEBAR_CLOSED = 'max-md:-translate-x-full max-md:rtl:translate-x-full';

@Component({
  selector: 'app-layout-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, BrandMarkComponent, ThemeToggleComponent, RouteFocusTargetDirective],
  template: `
    <!-- Mobile topbar (hidden on md+) -->
    <header
      class="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between
             border-b border-[var(--color-border)] bg-[var(--color-background)]
             px-4 md:hidden"
    >
      <button
        type="button"
        (click)="toggleDrawer()"
        [attr.aria-expanded]="isMobileDrawerOpen()"
        i18n-aria-label="@@layout.toggleNav"
        aria-label="Toggle navigation menu"
        class="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius)]
               text-[var(--color-foreground)] hover:bg-[var(--color-muted)]
               focus-visible:outline-none focus-visible:ring-2
               focus-visible:ring-[var(--color-primary)] transition-colors"
      >
        @if (isMobileDrawerOpen()) {
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        } @else {
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <line x1="4" x2="20" y1="12" y2="12" />
            <line x1="4" x2="20" y1="6" y2="6" />
            <line x1="4" x2="20" y1="18" y2="18" />
          </svg>
        }
      </button>
      <span class="text-sm font-semibold text-[var(--color-foreground)]">{{ brandName }}</span>
      <app-theme-toggle />
    </header>

    <!-- Backdrop (mobile drawer open) -->
    @if (isMobileDrawerOpen()) {
      <div
        class="fixed inset-0 z-30 bg-black/50 md:hidden"
        data-testid="drawer-backdrop"
        (click)="closeDrawer()"
        aria-hidden="true"
      ></div>
    }

    <!-- Page layout -->
    <div class="flex min-h-[calc(100vh-3.5rem)] md:min-h-screen">
      <!--
        \`inert\` while the drawer is closed, and this is a bug fix rather than a nicety.
        A closed drawer is \`-translate-x-full\`: moved off screen, and still rendered,
        still in the tab order and still in the accessibility tree. On a narrow viewport
        every link in it was reachable by Tab and readable by a screen reader while being
        invisible — so a keyboard visitor tabbing through the page fell into navigation
        they could not see, with the focus ring scrolled off the side of the document.
        \`inert\` is the one attribute that removes an element from both at once;
        \`aria-hidden\` alone would have left it tabbable, and \`display: none\` would have
        killed the slide-in transition the drawer exists to have.

        Never inert on desktop, where the same element is the static sidebar rather than
        a drawer, and never on the server, where \`isDesktopViewport()\` reports the
        \`mediaQuerySignal\` fallback instead of a measurement — prerendering it inert
        would hide the navigation from a visitor whose JavaScript has not arrived.
      -->
      <aside
        [class]="sidebarClasses()"
        [attr.inert]="isDrawerInert() ? '' : null"
        i18n-aria-label="@@layout.sidebarNav"
        aria-label="Sidebar navigation"
      >
        <!-- Desktop sidebar header -->
        <div
          class="hidden h-14 shrink-0 items-center justify-between
                 border-b border-[var(--color-border)] px-4 md:flex"
        >
          <span class="flex items-center gap-2">
            <!--
              Lazy and unprioritised, which is the ordinary case: the sidebar mark is 28
              pixels square and is never a page's largest painted element. The product
              name is the text beside it, so the image carries no \`alt\` of its own.
            -->
            <app-brand-mark />
            <span class="text-sm font-semibold text-[var(--color-foreground)]">
              {{ brandName }}
            </span>
          </span>
          <app-theme-toggle />
        </div>

        <!-- Mobile sidebar header with close button -->
        <div class="flex h-14 shrink-0 items-center justify-between px-4 md:hidden">
          <span class="flex items-center gap-2">
            <app-brand-mark />
            <span class="text-sm font-semibold text-[var(--color-foreground)]">
              {{ brandName }}
            </span>
          </span>
          <button
            type="button"
            (click)="closeDrawer()"
            i18n-aria-label="@@layout.closeNav"
            aria-label="Close navigation menu"
            class="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius)]
                   text-[var(--color-foreground)] hover:bg-[var(--color-muted)]
                   focus-visible:outline-none focus-visible:ring-2
                   focus-visible:ring-[var(--color-primary)] transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Nav content (projected) -->
        <nav class="flex-1 overflow-y-auto p-3">
          <ng-content select="[sidebar-nav]" />
        </nav>

        <!-- Sidebar footer (projected) -->
        <div class="shrink-0 border-t border-[var(--color-border)] p-3">
          <ng-content select="[sidebar-footer]" />
        </div>
      </aside>

      <!--
        \`appRouteFocusTarget\` is what makes a navigation between two dashboard routes
        observable to someone not looking at the screen: it carries the \`tabindex="-1"\`
        and the \`id\` that route focus and the skip link both aim at. This one \`<main>\`
        serves every route inside the shell — the element survives the navigation and its
        contents are what changed, which is exactly what focus should land on.
      -->
      <main appRouteFocusTarget class="min-w-0 flex-1 overflow-y-auto">
        <router-outlet />
      </main>
    </div>
  `,
})
export class LayoutShellComponent {
  @Input() brandName = 'App';

  /** `true` once the viewport is wide enough for the sidebar to be a static column. */
  readonly isDesktopViewport = mediaQuerySignal(DESKTOP_QUERY);

  /**
   * Open state of the off-canvas drawer, reset to closed every time the viewport crosses
   * the desktop breakpoint.
   *
   * State the user writes to that also has to be reset by something upstream is exactly
   * what `linkedSignal` is for: `computed` cannot express it because the drawer has two
   * writers, and the `effect` this replaced was a write into the reactive graph that ran
   * a flush late. Crossing the breakpoint turns the drawer into the static sidebar, so
   * the flag stops describing anything on screen — left set, it would reopen a drawer
   * nobody asked for the moment the viewport narrowed again.
   *
   * The reset fires in both directions, where the effect only fired on the way up. That
   * is not a behaviour change worth avoiding: above the breakpoint the flag is unreadable
   * and unwritable, so it can only ever be `false` on the way back down.
   *
   * The computation is annotated `: boolean` on purpose — inferred from `false` alone the
   * signal would be a `WritableSignal<false>` and `toggleDrawer` would not compile.
   */
  readonly isMobileDrawerOpen = linkedSignal<boolean, boolean>({
    source: this.isDesktopViewport,
    computation: (): boolean => false,
    debugName: 'isMobileDrawerOpen',
  });

  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /**
   * `true` only for the one state in which the sidebar is rendered but unreachable: a
   * narrow viewport with the drawer closed. See the comment on `<aside>`.
   */
  protected readonly isDrawerInert = computed(
    () => this.isBrowser && !this.isDesktopViewport() && !this.isMobileDrawerOpen()
  );

  protected readonly sidebarClasses = computed(() =>
    this.isMobileDrawerOpen()
      ? `${SIDEBAR_BASE} translate-x-0`
      : `${SIDEBAR_BASE} ${SIDEBAR_CLOSED}`
  );

  constructor() {
    inject(Router)
      .events.pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed()
      )
      .subscribe(() => this.isMobileDrawerOpen.set(false));
  }

  @HostListener('document:keydown.escape')
  onEscKey(): void {
    this.isMobileDrawerOpen.set(false);
  }

  toggleDrawer(): void {
    this.isMobileDrawerOpen.update((v) => !v);
  }

  closeDrawer(): void {
    this.isMobileDrawerOpen.set(false);
  }
}
