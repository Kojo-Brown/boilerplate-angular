import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastContainerComponent } from '@/app/shared/ui/toast/toast.component';
import { ThemeService } from '@/app/core/theme/theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ToastContainerComponent],
  template: `
    <router-outlet />
    <app-toast-container />
  `,
})
export class AppComponent {
  // Eagerly inject so the effect that syncs theme to <html> runs at app init
  readonly themeService = inject(ThemeService);
}
