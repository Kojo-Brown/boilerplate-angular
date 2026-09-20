import { FormArray, FormControl, FormGroup } from '@angular/forms';
import type { AbstractControl, AbstractControlOptions, FormControlOptions } from '@angular/forms';

/**
 * A field's contribution to a typed form: the control it builds, plus the raw value type
 * that control will hold.
 *
 * The second type parameter is the whole point of this interface, and `rawValue` is the
 * only reason it exists as a value rather than as a bare control. Angular's control
 * classes carry their value type through `value`, `setValue` and `patchValue` — a
 * property and two *methods* — and methods are compared bivariantly, so a
 * `FormControl<string | null>` satisfies a slot that asked for `string`: `setValue` is
 * checked in both directions and `string` is assignable to `string | null` in one of
 * them. That is not a corner case, it is the single mistake this helper exists to catch
 * (see `control` below for why `| null` appears at all), and a structural check against
 * `AbstractControl<unknown, TRaw>` alone cannot see it.
 *
 * `rawValue` puts `TRaw` in a function *property* — contravariant in its parameter,
 * covariant in its return, therefore invariant overall under `strictFunctionTypes`. A
 * spec whose raw value is wider or narrower than the field's is a type error in one
 * direction or the other. It is never called; it exists so that the two types have to
 * agree exactly. See `docs/typed-forms.md`.
 */
export interface FieldSpec<TControl extends AbstractControl, TRaw> {
  /** Constructs the control. Called once, by the enclosing `typedGroup`/`arrayOf`. */
  readonly build: () => TControl;
  /** Phantom. Pins `TRaw` invariantly; never invoked. */
  readonly rawValue: (raw: TRaw) => TRaw;
}

/** Any spec that produces a control holding `TRaw`, whatever kind of control that is. */
type AnyFieldSpec<TRaw> = FieldSpec<AbstractControl<unknown, TRaw>, TRaw>;

/**
 * The spec object a model type demands: one field per property, with no property
 * optional. `-?` is what makes a partially-specified form a compile error rather than a
 * form that is quietly missing a control — the failure `FormBuilder` cannot report,
 * because there the model is inferred *from* the spec and so agrees with it by
 * construction.
 *
 * An optional model property (`nickname?: string`) keeps `| undefined` in its value type
 * and still requires a control: a form either renders a field or it does not, and
 * "sometimes absent" is a fact about the payload, not about the form.
 */
export type SpecOf<TValue> = { [K in keyof TValue]-?: AnyFieldSpec<TValue[K]> };

/** The controls record a spec object builds — what ends up as `FormGroup`'s type argument. */
export type ControlsOf<TSpec> = {
  [K in keyof TSpec]: TSpec[K] extends FieldSpec<infer TControl, infer _TRaw> ? TControl : never;
};

/**
 * A spec object that matches `TValue` exactly: every property present (from `SpecOf`),
 * and nothing else.
 *
 * The second half is the self-referential `Record<Exclude<keyof TSpec, keyof TValue>, never>`.
 * Excess-property checking would catch a stray key in an object *literal*, but not in a
 * spec assembled from a variable or spread, and a form with a control the model has no
 * room for is the same drift in the other direction — it renders, it validates, and
 * `getRawValue()` silently carries a field the API will reject.
 */
type ExactSpecOf<TValue, TSpec> = SpecOf<TValue> &
  Record<Exclude<keyof TSpec, keyof TValue>, never>;

/** Everything `FormControl` accepts except the flag `control` owns. */
export type TypedControlOptions = Omit<FormControlOptions, 'nonNullable' | 'initialValueIsDefault'>;

/**
 * A non-nullable control holding `TValue`, seeded with `initialValue`.
 *
 * `nonNullable` is not a strictness preference, it is a statement about what `reset()`
 * does. A control built without it resets to `null` — that is the documented behaviour,
 * and it is why `new FormControl('')` is typed `FormControl<string | null>` rather than
 * the type being over-cautious. So a "clear the form" button on a nullable control puts
 * `null` into a field the template binds and the schema then rejects with *Expected
 * string, received null*, from a control the visitor never touched. With `nonNullable`,
 * `reset()` restores `initialValue` and the type loses the `| null` it had earned.
 *
 * Taking the initial value as a required argument rather than defaulting it is part of
 * the same decision: with `nonNullable` the initial value is also the reset value, so
 * there is no such thing as a control that does not have one.
 *
 * A field that genuinely holds nothing asks for it: `control<string | null>(null)`, whose
 * model property must be `string | null` too.
 *
 * Note the one ergonomic cost of the invariance described on `FieldSpec`: for a field
 * typed as a union of literals, the initial value alone infers too wide a type
 * (`control('on')` is a `FieldSpec<…, string>`), so the type argument has to be written
 * out — `control<'on' | 'off'>('on')`.
 */
export function control<TValue>(
  initialValue: TValue,
  options: TypedControlOptions = {}
): FieldSpec<FormControl<TValue>, TValue> {
  return {
    build: () => new FormControl(initialValue, { ...options, nonNullable: true }),
    rawValue: (raw) => raw,
  };
}

/**
 * A nested group, as a field of an enclosing one. Same checking as `typedGroup`, one
 * level down: `nestedGroup<Address>()({ … })` in a slot the model types as `Address`.
 */
export function nestedGroup<TValue extends object>() {
  return <TSpec extends ExactSpecOf<TValue, TSpec>>(
    spec: TSpec,
    options?: AbstractControlOptions
  ): FieldSpec<FormGroup<ControlsOf<TSpec>>, TValue> => ({
    build: () => new FormGroup(buildControls(spec), options),
    rawValue: (raw) => raw,
  });
}

/**
 * A `FormArray` of like-typed controls, as a field of a group.
 *
 * The items are specs rather than controls for the same reason the group's fields are:
 * an array of `new FormControl('')` would be an array of nullable controls, and
 * `FormArray<FormControl<string | null>>`'s raw value is `(string | null)[]`, which a
 * `string[]` field would accept through the same bivariance.
 */
export function arrayOf<TItem>() {
  return <TControl extends AbstractControl<unknown, TItem>>(
    items: readonly FieldSpec<TControl, TItem>[],
    options?: AbstractControlOptions
  ): FieldSpec<FormArray<TControl>, TItem[]> => ({
    build: () =>
      new FormArray(
        items.map((item) => item.build()),
        options
      ),
    rawValue: (raw) => raw,
  });
}

/**
 * A `FormGroup` checked against the model it is meant to produce.
 *
 * ```ts
 * const form = typedGroup<LoginFormData>()({
 *   email: control(''),
 *   password: control(''),
 * });
 * form.getRawValue(); // LoginFormData, not Partial<…> and not `| null`
 * ```
 *
 * `FormBuilder.group()` is already typed, and that is the problem: the types flow from
 * the spec to the form, so the form is whatever was written and agrees with itself by
 * construction. Nothing checks it against the interface it feeds. Delete a field from the
 * model and the form still builds it; add one and the form quietly lacks it; misspell a
 * key and both are true at once. Each of those compiles, renders, and fails at the API
 * boundary or — worse — silently submits the wrong shape.
 *
 * Here the model is the input: `TValue` is given, the spec is checked against it, and the
 * *controls* are still inferred from the spec so `form.controls.email` keeps its precise
 * type. See `docs/typed-forms.md` for the five mistakes this rejects and
 * `scripts/ci/fixtures/form-types/` for one fixture per mistake.
 *
 * Why curried: TypeScript has no partial type-argument inference. `typedGroup<LoginFormData>({…})`
 * would have to pin `TValue` *and* infer `TSpec` from one argument list, and supplying
 * either type argument means supplying both. Returning a second generic function splits
 * the two inference sites, which is the standard shape for this and the reason for the
 * empty `()`.
 *
 * `form.value` is deliberately left as Angular types it — `Partial<TValue>`, because a
 * disabled control is omitted from it at runtime. `getRawValue()` is the complete read
 * and the one to submit.
 */
export function typedGroup<TValue extends object>() {
  return <TSpec extends ExactSpecOf<TValue, TSpec>>(
    spec: TSpec,
    options?: AbstractControlOptions
  ): FormGroup<ControlsOf<TSpec>> => new FormGroup(buildControls(spec), options);
}

/**
 * Builds every field of a spec.
 *
 * The two casts are the loop: a mapped type cannot be assembled key by key without one,
 * since the record is only of type `ControlsOf<TSpec>` once the last key has been
 * written. Both are contained here, and `ControlsOf` is derived from the same specs
 * being iterated, so the assertion restates what the loop just did rather than claiming
 * anything new.
 */
function buildControls<TSpec extends Record<string, unknown>>(spec: TSpec): ControlsOf<TSpec> {
  const specs = spec as unknown as Record<string, { readonly build: () => AbstractControl }>;
  const controls: Record<string, AbstractControl> = {};
  for (const key of Object.keys(specs)) {
    controls[key] = specs[key].build();
  }
  return controls as ControlsOf<TSpec>;
}
