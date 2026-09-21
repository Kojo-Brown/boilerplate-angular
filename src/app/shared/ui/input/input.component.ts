import {
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  input,
  signal,
} from '@angular/core';
import type { ControlValueAccessor } from '@angular/forms';
import { NG_VALUE_ACCESSOR } from '@angular/forms';
import { hostControl } from '@/app/core/forms';

let nextId = 0;

const INPUT_BASE =
  'w-full rounded-[var(--radius)] border px-3 py-2 text-sm ' +
  'bg-[var(--color-background)] text-[var(--color-foreground)] ' +
  'placeholder:text-[var(--color-muted-foreground)] ' +
  'transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

/**
 * A labelled text input that reports its own control's validation state.
 *
 * The simple half of the pattern {@link file://../tag-input/tag-input.component.ts | TagInputComponent}
 * shows the whole of: this accessor *consumes* validity and contributes none, because a
 * text box has no rule of its own to enforce — the rules live in the schema the form was
 * built from. So it provides `NG_VALUE_ACCESSOR` and not `NG_VALIDATORS`, and the two
 * halves of "validation integration" turn out to be independent. See
 * `docs/control-value-accessor.md`.
 *
 * ## What changed, and why it is not cosmetic
 *
 * This component used to take `error` as an `@Input()`, so every form using it wrote:
 *
 * ```html
 * <app-input label="Email" [error]="emailError()" formControlName="email" />
 * ```
 *
 * which type-checks, renders, and is wrong in the ways nothing catches: the binding can
 * name a *different* field's error signal, it can be omitted entirely, and a message that
 * arrives from anywhere other than the control — a server-side `setErrors`, an async
 * validator settling — never reaches the input at all unless the page thought to wire
 * that too. Every one of those failures is silent, and all of them are a form telling a
 * component something the control it is already bound to knows better.
 *
 * {@link hostControl} takes the message from the control instead, which is also what makes
 * `aria-invalid` and the red border agree with it: three bindings that used to be
 * maintained in parallel are now one signal.
 */
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
      @if (label() !== '') {
        <label [for]="inputId" class="text-sm font-medium text-[var(--color-foreground)]">
          {{ label() }}
        </label>
      }
      <input
        [id]="inputId"
        [type]="type()"
        [placeholder]="placeholder()"
        [attr.autocomplete]="autocomplete() === '' ? null : autocomplete()"
        [disabled]="isDisabled()"
        [value]="value()"
        [attr.aria-invalid]="field.showsError() ? 'true' : null"
        [attr.aria-describedby]="describedBy()"
        (input)="onInput($event)"
        (blur)="onTouched()"
        [class]="inputClasses()"
      />
      @if (hint() !== '') {
        <p [id]="hintId" class="text-xs text-[var(--color-muted-foreground)]">{{ hint() }}</p>
      }
      @if (field.errorMessage(); as message) {
        <p [id]="errorId" class="text-xs text-[var(--color-destructive)]" role="alert">
          {{ message }}
        </p>
      }
    </div>
  `,
})
export class InputComponent implements ControlValueAccessor {
  readonly label = input('');
  readonly type = input('text');
  readonly placeholder = input('');
  readonly autocomplete = input('');
  /** Standing guidance shown under the field, announced alongside any error. */
  readonly hint = input('');

  private readonly id = ++nextId;
  protected readonly inputId = `app-input-${this.id}`;
  protected readonly hintId = `app-input-${this.id}-hint`;
  protected readonly errorId = `app-input-${this.id}-error`;

  protected readonly field = hostControl({ label: () => this.label() });

  protected readonly value = signal('');
  protected readonly isDisabled = signal(false);

  /**
   * Both descriptions, in reading order, or `null` for none.
   *
   * `aria-describedby` takes a list and the error has to be *in* it rather than replacing
   * the hint: a screen reader announces the elements it names, so dropping the hint while
   * an error is showing takes the format rule away exactly when it is being asked for.
   */
  protected readonly describedBy = computed(() => {
    const ids = [
      ...(this.hint() === '' ? [] : [this.hintId]),
      ...(this.field.errorMessage() === null ? [] : [this.errorId]),
    ];
    return ids.length === 0 ? null : ids.join(' ');
  });

  protected readonly inputClasses = computed(() => {
    const border = this.field.showsError()
      ? 'border-[var(--color-destructive)]'
      : 'border-[var(--color-border)]';
    return `${INPUT_BASE} ${border}`;
  });

  private onChange: (value: string) => void = () => {};
  protected onTouched: () => void = () => {};

  writeValue(value: string | null): void {
    // First line, and the reason `hostControl` exists: see its documentation for why this
    // is the one hook where the control is reachable under both binding syntaxes.
    this.field.connect();
    this.value.set(value ?? '');
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.isDisabled.set(isDisabled);
  }

  protected onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.value.set(value);
    this.onChange(value);
  }
}
