import { Component } from '@angular/core';

@Component({
  selector: 'app-admin',
  standalone: true,
  template: `<div>Admin — protected by authGuard + roleGuard('admin')</div>`,
})
export class AdminComponent {}
