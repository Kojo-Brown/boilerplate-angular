import {
  Component,
  Input,
  forwardRef,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  inject,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

let nextId = 0;

const INPUT_BASE =
  'w-full rounded-[var(--radius)] border px-3 py-2 text-sm ' +
  'bg-[var(--color-background)] text-[var(--color-foreground)] ' +
  'placeholder:text-[var(--color-muted-foreground)] ' +
  'transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

@Component({
  selector: 'app-input',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => InputComponent),
      multi: true,
    },
  ],
  template: `
    <div class="flex flex-col gap-1">
      @if (label) {
        <label [for]="id" class="text-sm font-medium text-[var(--color-foreground)]">
          {{ label }}
        </label>
      }
      <input
        [id]="id"
        [type]="type"
        [placeholder]="placeholder"
        [disabled]="isDisabled"
        [value]="value"
        [attr.aria-invalid]="!!error || null"
        [attr.aria-describedby]="error ? id + '-error' : null"
        (input)="onInput($event)"
        (blur)="onTouched()"
        [class]="inputClasses"
      />
      @if (error) {
        <p [id]="id + '-error'" class="text-xs text-[var(--color-destructive)]" role="alert">
          {{ error }}
        </p>
      }
    </div>
  `,
})
export class InputComponent implements ControlValueAccessor {
  @Input() label = '';
  @Input() type = 'text';
  @Input() placeholder = '';
  @Input() error = '';

  protected readonly id = `app-input-${++nextId}`;
  protected value = '';
  protected isDisabled = false;

  private onChange: (v: string) => void = () => {};
  protected onTouched: () => void = () => {};

  private readonly cdr = inject(ChangeDetectorRef);

  protected get inputClasses(): string {
    const border = this.error
      ? 'border-[var(--color-destructive)]'
      : 'border-[var(--color-border)]';
    return `${INPUT_BASE} ${border}`;
  }

  writeValue(value: string): void {
    this.value = value ?? '';
    this.cdr.markForCheck();
  }

  registerOnChange(fn: (v: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.isDisabled = isDisabled;
    this.cdr.markForCheck();
  }

  protected onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.value = value;
    this.onChange(value);
  }
}
