import {
  Component,
  Input,
  ChangeDetectionStrategy,
  inject,
  InjectionToken,
} from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';

export const DIALOG_DATA = new InjectionToken<unknown>('DIALOG_DATA');

@Component({
  selector: 'app-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host {
        display: block;
        width: var(--dialog-width, 32rem);
        max-width: 90vw;
      }
    `,
  ],
  template: `
    <div
      role="dialog"
      aria-modal="true"
      [attr.aria-labelledby]="title ? 'dialog-title' : null"
      class="flex flex-col rounded-[var(--radius)] border border-[var(--color-border)]
        bg-[var(--color-background)] shadow-xl max-h-[85vh] overflow-hidden"
    >
      <div
        class="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-6 py-4"
      >
        @if (title) {
          <h2 id="dialog-title" class="text-lg font-semibold text-[var(--color-foreground)]">
            {{ title }}
          </h2>
        }
        <button
          type="button"
          (click)="close()"
          class="ml-auto rounded p-1 text-[var(--color-muted-foreground)] transition-colors
            hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          aria-label="Close dialog"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div class="overflow-auto flex-1">
        <ng-content />
      </div>
    </div>
  `,
})
export class DialogComponent {
  @Input() title = '';

  private readonly dialogRef = inject(DialogRef, { optional: true });

  close(result?: unknown): void {
    this.dialogRef?.close(result);
  }
}

export { DialogRef };
