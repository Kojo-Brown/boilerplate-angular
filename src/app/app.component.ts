import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastContainerComponent } from '@/app/shared/ui/toast/toast.component';
import { ThemeService } from '@/app/core/theme/theme.service';
import { RouteAnnouncerComponent, SkipLinkComponent } from '@/app/core/a11y';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ToastContainerComponent, RouteAnnouncerComponent, SkipLinkComponent],
  template: `
    <!--
      First in the tab order, which is the whole of what a skip link is: it has to be
      reachable before the navigation it exists to skip, and the only way to guarantee
      that across every route is to put it above the outlet rather than inside whichever
      shell the route happens to render.
    -->
    <app-skip-link />
    <router-outlet />
    <app-toast-container />
    <!--
      Rendered here, at the root, for the reason \`live-region.component.ts\` gives: a live
      region has to be in the accessibility tree *before* it has anything to say, so it is
      part of the application shell rather than something a navigation creates. It sits
      outside the outlet so that it survives the navigation it is reporting on.
    -->
    <app-route-announcer />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  // Eagerly inject so the effect that syncs theme to <html> runs at app init
  readonly themeService = inject(ThemeService);
}
