import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-admin',
  standalone: true,
  template: `<div>Admin — protected by authGuard + roleGuard('admin')</div>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminComponent {}
