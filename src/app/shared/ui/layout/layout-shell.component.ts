import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  Input,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { ThemeToggleComponent } from '../theme-toggle/theme-toggle.component';

const SIDEBAR_BASE =
  'fixed inset-y-0 left-0 z-40 flex w-64 flex-col ' +
  'border-r border-[var(--color-border)] bg-[var(--color-background)] ' +
  'transition-transform duration-200 ease-in-out md:static md:translate-x-0';

@Component({
  selector: 'app-layout-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, ThemeToggleComponent],
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
        aria-label="Toggle navigation menu"
        class="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius)]
               text-[var(--color-foreground)] hover:bg-[var(--color-muted)]
               focus-visible:outline-none focus-visible:ring-2
               focus-visible:ring-[var(--color-primary)] transition-colors"
      >
        @if (isMobileDrawerOpen()) {
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
               stroke-linejoin="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12"/>
          </svg>
        } @else {
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
               stroke-linejoin="round" aria-hidden="true">
            <line x1="4" x2="20" y1="12" y2="12"/>
            <line x1="4" x2="20" y1="6" y2="6"/>
            <line x1="4" x2="20" y1="18" y2="18"/>
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
      <!-- Sidebar: off-canvas drawer on mobile, static column on desktop -->
      <aside [class]="sidebarClasses()" aria-label="Sidebar navigation">

        <!-- Desktop sidebar header -->
        <div
          class="hidden h-14 shrink-0 items-center justify-between
                 border-b border-[var(--color-border)] px-4 md:flex"
        >
          <span class="text-sm font-semibold text-[var(--color-foreground)]">{{ brandName }}</span>
          <app-theme-toggle />
        </div>

        <!-- Mobile sidebar header with close button -->
        <div class="flex h-14 shrink-0 items-center justify-between px-4 md:hidden">
          <span class="text-sm font-semibold text-[var(--color-foreground)]">{{ brandName }}</span>
          <button
            type="button"
            (click)="closeDrawer()"
            aria-label="Close navigation menu"
            class="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius)]
                   text-[var(--color-foreground)] hover:bg-[var(--color-muted)]
                   focus-visible:outline-none focus-visible:ring-2
                   focus-visible:ring-[var(--color-primary)] transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
                 fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                 stroke-linejoin="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12"/>
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

      <!-- Main content area -->
      <main class="min-w-0 flex-1 overflow-y-auto">
        <router-outlet />
      </main>
    </div>
  `,
})
export class LayoutShellComponent {
  @Input() brandName = 'App';

  readonly isMobileDrawerOpen = signal(false);

  protected readonly sidebarClasses = computed(() =>
    this.isMobileDrawerOpen()
      ? `${SIDEBAR_BASE} translate-x-0`
      : `${SIDEBAR_BASE} -translate-x-full`
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
