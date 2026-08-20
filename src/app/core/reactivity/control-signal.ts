import { computed, inject, Injector } from '@angular/core';
import type { Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import type { AbstractControl, FormControlStatus, ValidationErrors } from '@angular/forms';

/**
 * Everything a template asks a reactive-forms control about, as plain data.
 *
 * Deliberately a snapshot rather than a reference to the control: a `computed` reading
 * `control.touched` directly would never re-run, because a control is not a signal.
 */
export interface ControlState<TValue> {
  readonly value: TValue;
  readonly status: FormControlStatus;
  readonly valid: boolean;
  readonly invalid: boolean;
  readonly pending: boolean;
  readonly disabled: boolean;
  readonly touched: boolean;
  readonly dirty: boolean;
  readonly errors: ValidationErrors | null;
}

export interface ControlSignalOptions {
  /**
   * Injector owning the subscription to `control.events`. Required when `controlSignal`
   * is called outside an injection context (a lifecycle hook, an event handler, an
   * async callback).
   */
  injector?: Injector;
  /** Debug name shown for the computed in Angular DevTools. */
  debugName?: string;
}

/**
 * A signal of everything a template needs to know about a reactive-forms control.
 *
 * ```ts
 * protected readonly email = controlSignal(this.form.controls.email);
 * // template: @if (email().touched && email().invalid) { … }
 * ```
 *
 * This is the canonical Observable → Signal boundary in an Angular app: reactive forms
 * predate signals and publish their state as `AbstractControl.events`, so the graph
 * cannot see a control's value, validity or touched flag until something bridges them.
 * `toSignal` is that bridge, and it is the right one here because the stream *is* a
 * value the view renders — not a side effect, which would want a subscription instead.
 * See `docs/rxjs-interop.md` for the decision table.
 *
 * Why it matters under zoneless change detection: reading `control.touched` from a
 * template getter is only as fresh as the last refresh, and a refresh only happens when
 * something tells Angular to look. Typing and blurring do tell it — those arrive through
 * the value accessor's bound host listeners — but a control mutated from anywhere else
 * does not: an async validator settling, `setErrors` from a server response,
 * `patchValue` from a resolver, `markAllAsTouched` from a timer. Those all emit on
 * `events`, so a signal built from it refreshes the view and a getter does not.
 *
 * The snapshot is compared field by field, so an event that changes nothing a template
 * reads — a `FormSubmittedEvent`, or revalidation producing the same errors — does not
 * invalidate the downstream `computed`s.
 *
 * @param control Control to track. Also accepts a `FormGroup` or `FormArray`, whose
 *   `errors` carry the cross-field validators.
 * @param options `injector` when called outside an injection context.
 */
export function controlSignal<TValue>(
  control: AbstractControl<TValue>,
  options: ControlSignalOptions = {}
): Signal<ControlState<TValue>> {
  const injector = options.injector ?? inject(Injector);

  // `events` has no replay: it emits changes, never the current state. That is why the
  // initial value is `null` and the state below is always read off the control rather
  // than off the event — the event only says *that* something changed.
  const lastEvent = toSignal(control.events, { initialValue: null, injector });

  return computed(
    () => {
      lastEvent();
      return snapshot(control);
    },
    {
      equal: controlStateEqual,
      debugName: options.debugName ?? 'controlSignal',
    }
  );
}

export interface ControlErrorSignalOptions extends ControlSignalOptions {
  /**
   * Show the message before the control has been touched. Off by default: reporting
   * "email is required" into an empty form the user has not reached yet is noise.
   */
  showUntouched?: boolean;
}

/**
 * The message stored under `errorKey`, surfaced only once the control has been touched.
 *
 * ```ts
 * protected readonly emailError = controlErrorSignal(this.form.controls.email, 'zod');
 * ```
 *
 * `zodValidator` writes its message under the `zod` key; a validator that stores
 * something other than a string under `errorKey` yields `null` rather than rendering
 * `[object Object]`.
 *
 * @param control Control to read the error from.
 * @param errorKey Key within `ValidationErrors` holding the message.
 * @param options `showUntouched` to report immediately; `injector` outside an
 *   injection context.
 */
export function controlErrorSignal(
  control: AbstractControl,
  errorKey: string,
  options: ControlErrorSignalOptions = {}
): Signal<string | null> {
  const state = controlSignal(control, {
    injector: options.injector,
    debugName: options.debugName ?? 'controlErrorSignal',
  });

  return computed(() => {
    const { touched, errors } = state();
    if (!touched && !options.showUntouched) return null;
    const message = errors?.[errorKey] as unknown;
    return typeof message === 'string' ? message : null;
  });
}

function snapshot<TValue>(control: AbstractControl<TValue>): ControlState<TValue> {
  return {
    value: control.value,
    status: control.status,
    valid: control.valid,
    invalid: control.invalid,
    pending: control.pending,
    disabled: control.disabled,
    touched: control.touched,
    dirty: control.dirty,
    errors: control.errors,
  };
}

/** `valid`, `invalid`, `pending` and `disabled` are all functions of `status`, so
 * comparing `status` covers them. */
function controlStateEqual<TValue>(a: ControlState<TValue>, b: ControlState<TValue>): boolean {
  return (
    Object.is(a.value, b.value) &&
    a.status === b.status &&
    a.touched === b.touched &&
    a.dirty === b.dirty &&
    errorsEqual(a.errors, b.errors)
  );
}

/**
 * Validators build a fresh `ValidationErrors` object on every run, so identity says
 * nothing. One level deep is the right depth: the values are messages and flags, and a
 * validator storing a mutable object there would defeat any comparison short of a deep
 * one.
 */
function errorsEqual(a: ValidationErrors | null, b: ValidationErrors | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;

  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.is(a[key], b[key]));
}
