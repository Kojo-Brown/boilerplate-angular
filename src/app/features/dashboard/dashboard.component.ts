import { Component } from '@angular/core';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  template: `<div>Dashboard — protected by authGuard</div>`,
})
export class DashboardComponent {}
