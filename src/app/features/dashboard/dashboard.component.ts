import { ChangeDetectionStrategy, Component } from '@angular/core';
import { WidgetBoardComponent } from './widgets/widget-board.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [WidgetBoardComponent],
  template: `
    <h2 class="text-lg font-semibold text-[var(--color-foreground)]">Overview</h2>
    <div class="mt-4">
      <app-widget-board />
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent {}
