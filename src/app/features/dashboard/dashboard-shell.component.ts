import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthStore } from '@/app/store/auth/auth.store';

@Component({
  selector: 'app-dashboard-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="flex min-h-screen">
      <nav class="w-56 shrink-0 border-r border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <div class="mb-6">
          <span class="text-sm font-semibold text-gray-500 uppercase tracking-wider dark:text-gray-400">
            Dashboard
          </span>
        </div>
        <ul class="space-y-1">
          <li>
            <a
              routerLink="/dashboard"
              routerLinkActive="bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
              [routerLinkActiveOptions]="{ exact: true }"
              class="flex items-center rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              Overview
            </a>
          </li>
          <li>
            <a
              routerLink="/dashboard/posts"
              routerLinkActive="bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
              class="flex items-center rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              Posts
            </a>
          </li>
        </ul>
        <div class="mt-auto pt-4 border-t border-gray-200 dark:border-gray-700">
          <button
            (click)="onLogout()"
            class="w-full rounded-md px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            Sign out
          </button>
        </div>
      </nav>
      <main class="flex-1 overflow-auto">
        <router-outlet />
      </main>
    </div>
  `,
})
export class DashboardShellComponent {
  private readonly authStore = inject(AuthStore);

  onLogout(): void {
    this.authStore.logout();
  }
}
