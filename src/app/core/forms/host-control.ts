import { computed, inject, Injector, signal } from '@angular/core';
import type { Signal } from '@angular/core';
import { NgControl } from '@angular/forms';
import type { AbstractControl } from '@angular/forms';
import { controlSignal } from '@/app/core/reactivity';
import type { ControlState } from '@/app/core/reactivity';
import { FIELD_ERROR_MESSAGES, resolveFieldError } from './error-messages';
import type { FieldErrorMessages } from './error-messages';

export interface HostControlOptions {
  /**
   * The field's visible label, read when a message names it. A function rather than a
   * string because the caller's label is usually a signal `input()`, and this is called
   * from a field initialiser — before that input has its first value.
   */
  readonly label?: () => string;
  /**
   * Messages for error keys the component produces itself, layered over
   * {@link FIELD_ERROR_MESSAGES}. See {@link file://./error-messages.ts}.
   */
  readonly messages?: FieldErrorMessages;
  /**
   * Report errors before the control has been touched. Off by default, for the reason
   * `controlErrorSignal` has it off: an untouched field is one the visitor has not
   * reached yet.
   */
  readonly showUntouched?: boolean;
}

/** The host control's state, as a value accessor's own template needs to see it. */
export interface HostControl {
  /**
   * Bind this accessor to the form control driving it.
   *
   * **Call it from `writeValue`** — the first line, before storing the value. See the
   * note on {@link hostControl} for why that and not `ngOnInit`. Calling it more than
   * once is free, and calling it when there is no control (the component used without a
   * form directive) is a no-op that will be retried.
   */
  connect(): void;
  /** The control this accessor is bound to, or `null` before {@link connect}. */
  readonly control: Signal<AbstractControl | null>;
  /** Everything the control publishes, as a snapshot. `null` before {@link connect}. */
  readonly state: Signal<ControlState<unknown> | null>;
  /**
   * Whether the field should be showing itself as invalid right now — invalid *and*
   * touched, unless `showUntouched` says otherwise. This is what drives `aria-invalid`
   * and the error styling, so both agree with the message below by construction.
   */
  readonly showsError: Signal<boolean>;
  /** The message to render, or `null` when the field should not be showing one. */
  readonly errorMessage: Signal<string | null>;
}

/**
 * The half of "value accessor" that Angular does not give you: the control's validity,
 * its touched flag and its errors, for a component that renders its own error state.
 *
 * ```ts
 * export class InputComponent implements ControlValueAccessor {
 *   protected readonly field = hostControl({ label: () => this.label() });
 *
 *   writeValue(value: string | null): void {
 *     this.field.connect();
 *     this.value.set(value ?? '');
 *   }
 * }
 * ```
 *
 * A `ControlValueAccessor` is told the value and nothing else. It does not learn that the
 * control is invalid, that it has been touched, or what the errors say — which is why the
 * usual custom input takes an `error` string `@Input()` and makes every form that uses it
 * wire the message across by hand, for every field, correctly, forever. That input is the
 * smell this replaces: the control already knows, and the accessor is sitting on the same
 * element as the directive holding it.
 *
 * ## Why this cannot simply inject `NgControl`
 *
 * Because the component provides `NG_VALUE_ACCESSOR` (and, if it validates, `NG_VALIDATORS`)
 * on itself, and the form directive *injects* those tokens from the element it shares with
 * the component. Injecting `NgControl` in the constructor therefore asks for a directive
 * that is in the middle of being constructed, and Angular says so:
 *
 * ```
 * NG0200: Circular dependency detected for `TagInputComponent`.
 * Path: TagInputComponent -> unknown -> FormControlName -> InjectionToken NgValidators -> TagInputComponent
 * ```
 *
 * The workaround everyone knows — drop the `NG_VALUE_ACCESSOR` provider and assign
 * `ngControl.valueAccessor = this` in the constructor instead — breaks that particular
 * cycle, and it is genuinely the right answer for an accessor that only reads. It does
 * not extend to `NG_VALIDATORS`: there is no `ngControl.validator = this` to assign, and
 * a component that wants to be both ends up back at NG0200 by a second path. Resolving
 * the directive *after* construction keeps both providers declarative.
 *
 * ## Why `connect()` from `writeValue`, and not `ngOnInit`
 *
 * `ngOnInit` is too early, in a way that only shows up under one of the two binding
 * syntaxes. `FormControlDirective` (`[formControl]`) takes its control as an `@Input`, so
 * it is set before any hook runs. `FormControlName` (`formControlName`) does not have one
 * — it looks its control up out of the parent `FormGroupDirective` in its own
 * `ngOnChanges`, which runs *after* the hooks of the component sharing its element. So
 * `injector.get(NgControl).control` in `ngOnInit` is the control under `[formControl]`
 * and `null` under `formControlName`, and a component built and specced against the first
 * one silently renders no validation state in the forms that use the second.
 *
 * `writeValue` is the first moment both syntaxes agree on: `setUpControl` calls it, and it
 * calls it *after* binding the control to the directive. It is also still before the
 * accessor's own template has been rendered, so the state this sets up is in place for the
 * first frame rather than arriving in a second change-detection pass.
 *
 * `ngAfterViewInit` would also see the control, and is the other defensible choice. It
 * costs an extra pass and, in a fixture with `checkNoChanges` on, turns any binding that
 * reacts to connecting into an `ExpressionChangedAfterItHasBeenCheckedError`.
 *
 * @param options `label` for messages that name the field, `messages` for error keys the
 *   component contributes itself, `showUntouched` to report immediately.
 */
export function hostControl(options: HostControlOptions = {}): HostControl {
  const injector = inject(Injector);
  // Layered rather than replaced: the application's map still answers for `required` and
  // `zod` in a component that only adds messages for its own keys.
  const messages: FieldErrorMessages = { ...inject(FIELD_ERROR_MESSAGES), ...options.messages };
  // The keys this component contributes. They rank ahead of the application's generic
  // ones when several are failing at once: a rule only the accessor can check is a more
  // specific answer than one any validator could have given. See `resolveFieldError`.
  const ownKeys = Object.keys(options.messages ?? {});
  const label = options.label ?? (() => '');

  const control = signal<AbstractControl | null>(null);
  // A signal holding a signal, set once by `connect`. The alternative is a closure
  // variable plus a `ready` flag, which is the same thing with a non-null assertion
  // where this has `?.()`.
  const source = signal<Signal<ControlState<unknown>> | null>(null);
  const state = computed(() => source()?.() ?? null);

  const showsError = computed(() => {
    const snapshot = state();
    if (snapshot === null || !snapshot.invalid) return false;
    return snapshot.touched || options.showUntouched === true;
  });

  const errorMessage = computed(() => {
    if (!showsError()) return null;
    const snapshot = state();
    if (snapshot === null) return null;
    return resolveFieldError(snapshot.errors, messages, { label: label() }, ownKeys);
  });

  return {
    connect(): void {
      if (control() !== null) return;

      // `self` is load-bearing: without it the lookup walks up the element-injector chain
      // and a value accessor rendered inside another form control's template binds to
      // *that* control — reporting a parent's errors under a child's label, with nothing
      // failing. `optional` because a component may legitimately be used with no form
      // directive at all, bound to `[value]` like a plain element.
      const directive = injector.get(NgControl, null, { self: true, optional: true });
      const target = directive?.control ?? null;
      if (target === null) return;

      control.set(target);
      source.set(controlSignal(target, { injector, debugName: 'hostControl' }));
    },
    control: control.asReadonly(),
    state,
    showsError,
    errorMessage,
  };
}
