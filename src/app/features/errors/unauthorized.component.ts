import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouteFocusTargetDirective } from '@/app/core/a11y';

@Component({
  selector: 'app-unauthorized',
  standalone: true,
  imports: [RouteFocusTargetDirective],
  // `<main>` for the reason login.component.ts gives: this route renders outside
  // `LayoutShellComponent`, so it has to provide its own landmark. The explanatory line
  // moves off `text-gray-500`, which is 4.19:1 on the dark background — the palette has
  // a token for secondary text and it clears 4.5:1 in both themes.
  template: `<main appRouteFocusTarget class="p-8 text-center">
    <h1 i18n="@@errors.unauthorized.heading" class="text-2xl font-bold">403 — Unauthorized</h1>
    <p i18n="@@errors.unauthorized.body" class="mt-2 text-[var(--color-muted-foreground)]">
      You do not have permission to view this page.
    </p>
  </main>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UnauthorizedComponent {}
