import { Component } from '@angular/core';

@Component({
  selector: 'app-unauthorized',
  standalone: true,
  template: `<div class="p-8 text-center">
    <h1 class="text-2xl font-bold">403 — Unauthorized</h1>
    <p class="mt-2 text-gray-500">You do not have permission to view this page.</p>
  </div>`,
})
export class UnauthorizedComponent {}
