import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  OnInit,
  inject,
} from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Toast, ToastType, ToastService } from './toast.service';

const TYPE_STYLES: Record<ToastType, string> = {
  success:
    'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300',
  error:
    'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300',
  warning:
    'border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300',
  info: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300',
};

@Component({
  selector: 'app-toast-item',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div role="status" [class]="containerClasses">
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
        class="mt-0.5 shrink-0"
        aria-hidden="true"
      >
        @switch (toast.type) {
          @case ('success') {
            <path d="M20 6L9 17l-5-5" />
          }
          @case ('error') {
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          }
          @case ('warning') {
            <path
              d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
            />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          }
          @default {
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          }
        }
      </svg>

      <p class="flex-1 text-sm font-medium">{{ toast.message }}</p>

      <button
        type="button"
        (click)="dismiss.emit()"
        class="ml-2 shrink-0 rounded p-0.5 opacity-70 transition-opacity hover:opacity-100
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
        aria-label="Dismiss notification"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  `,
})
export class ToastItemComponent implements OnInit {
  @Input({ required: true }) toast!: Toast;
  @Output() readonly dismiss = new EventEmitter<void>();

  private readonly liveAnnouncer = inject(LiveAnnouncer);

  protected get containerClasses(): string {
    return `flex w-full items-start gap-3 rounded-[var(--radius)] border px-4 py-3 shadow-md ${TYPE_STYLES[this.toast.type]}`;
  }

  ngOnInit(): void {
    void this.liveAnnouncer.announce(this.toast.message, 'polite');
  }
}

@Component({
  selector: 'app-toast-container',
  standalone: true,
  imports: [ToastItemComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      aria-label="Notifications"
      class="pointer-events-none fixed right-4 top-4 z-50 flex w-full max-w-sm flex-col gap-2"
    >
      @for (toast of toastService.toasts(); track toast.id) {
        <div class="pointer-events-auto">
          <app-toast-item [toast]="toast" (dismiss)="toastService.dismiss(toast.id)" />
        </div>
      }
    </div>
  `,
})
export class ToastContainerComponent {
  protected readonly toastService = inject(ToastService);
}
