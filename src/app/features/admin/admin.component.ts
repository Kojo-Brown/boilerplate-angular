import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouteFocusTargetDirective } from '@/app/core/a11y';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [RouteFocusTargetDirective],
  // `<main>` and an `<h1>` for the reason login.component.ts gives. This route is a
  // placeholder, but a placeholder with no landmark and no heading is one an axe run has
  // to report, so it carries the structure any real page here would.
  template: `<main appRouteFocusTarget class="p-8">
    <h1 i18n="@@admin.heading" class="text-2xl font-bold text-[var(--color-foreground)]">Admin</h1>
    <p i18n="@@admin.body" class="mt-2 text-[var(--color-muted-foreground)]">
      Protected by authGuard + roleGuard('admin').
    </p>
  </main>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminComponent {}
