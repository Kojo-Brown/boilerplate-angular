import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthFacade } from '@/app/core/auth';
import { LayoutShellComponent } from '@/app/shared/ui/layout/layout-shell.component';

const NAV_LINK =
  'flex items-center rounded-[var(--radius)] px-3 py-2 text-sm font-medium ' +
  'text-[var(--color-foreground)] hover:bg-[var(--color-muted)] transition-colors';

const NAV_LINK_ACTIVE = 'bg-[var(--color-muted)] text-[var(--color-primary)]';

@Component({
  selector: 'app-dashboard-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, LayoutShellComponent],
  template: `
    <app-layout-shell brandName="Dashboard">
      <ul sidebar-nav class="space-y-1">
        <li>
          <a
            routerLink="/dashboard"
            [routerLinkActive]="navLinkActive"
            [routerLinkActiveOptions]="{ exact: true }"
            [class]="navLink"
          >
            Overview
          </a>
        </li>
        <li>
          <a routerLink="/dashboard/posts" [routerLinkActive]="navLinkActive" [class]="navLink">
            Posts
          </a>
        </li>
      </ul>

      <div sidebar-footer class="space-y-1">
        @if (auth.currentUser(); as user) {
          <p class="px-3 py-1">
            <span class="block truncate text-sm font-medium text-[var(--color-foreground)]">
              {{ user.name }}
            </span>
            <span class="block truncate text-xs text-[var(--color-muted-foreground)]">
              {{ user.email }}
            </span>
          </p>
        }
        <button
          type="button"
          (click)="onLogout()"
          class="w-full rounded-[var(--radius)] px-3 py-2 text-left text-sm font-medium
                 text-[var(--color-foreground)] hover:bg-[var(--color-muted)] transition-colors"
        >
          Sign out
        </button>
      </div>
    </app-layout-shell>
  `,
})
export class DashboardShellComponent {
  protected readonly navLink = NAV_LINK;
  protected readonly navLinkActive = NAV_LINK_ACTIVE;

  protected readonly auth = inject(AuthFacade);

  onLogout(): void {
    this.auth.signOut();
  }
}
