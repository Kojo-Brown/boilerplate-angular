import { FormGroup } from '@angular/forms';
import type { AbstractControl, AbstractControlOptions, FormControl } from '@angular/forms';
import type { ZodObject, ZodRawShape, input } from 'zod';
import { zodValidator } from '@/app/core/validators/zod-validator';
import { control } from './typed-form';

/**
 * What a form for `TShape` holds while it is being filled in.
 *
 * `input` and not `infer`: `z.infer` is a schema's *output* type, and for anything with a
 * transform or a coercion the two differ. `z.coerce.number()` outputs `number` and
 * accepts `unknown`; `z.string().transform(Number)` outputs `number` from a `string`. A
 * form holds what the visitor typed, which is the input side — typing the controls on the
 * output would produce a `FormControl<number>` bound to a text input, and `getRawValue()`
 * would claim the parse had already happened.
 *
 * For a schema with neither, the two coincide, which is why `onSubmit` can look
 * redundant. It is not: `safeParse(form.getRawValue())` is what turns the input type into
 * the output type, and it stays correct the day someone adds a `.transform()`.
 */
export type SchemaInput<TShape extends ZodRawShape> = input<ZodObject<TShape>>;

/** The controls a schema produces: one non-nullable `FormControl` per key in its shape. */
export type SchemaControls<TShape extends ZodRawShape> = {
  [K in keyof SchemaInput<TShape>]-?: FormControl<SchemaInput<TShape>[K]>;
};

/**
 * A `FormGroup` whose fields, types and per-field validators all come from one Zod object
 * schema.
 *
 * ```ts
 * const form = schemaGroup(loginSchema, { email: '', password: '' });
 * ```
 *
 * `typedGroup` stops the form drifting from the model; this stops the *validators*
 * drifting from the schema, which is the other half of the same problem and the one that
 * fails quietly. Wiring `zodValidator(schema.shape.email)` per field by hand is correct
 * until a field is added — at which point `typedGroup` does report the missing control,
 * but a field wired to the *wrong* sibling's rule, or to none, is a form that submits
 * values the server rejects while the client showed no error. Reading the shape means
 * there is no per-field wiring to get wrong.
 *
 * Flat schemas only, and on purpose. A nested `z.object()` field would produce a
 * `FormControl` holding an object rather than a nested `FormGroup`; that control is
 * well-typed and validates correctly, but it is not the form anyone wanted. Compose
 * `typedGroup` with `nestedGroup` for that — the schema is one field's validator, not the
 * form's structure.
 *
 * Cross-field rules stay where they belong, on the group: `registerSchema`'s
 * "passwords don't match" is a property of the pair, so it arrives as
 * `{ validators: zodGroupValidator(registerSchema) }` against the *base* object schema
 * here — `.refine()` returns a `ZodEffects`, which has no `.shape` to read and could not
 * seed the fields even if it did.
 */
export function schemaGroup<TShape extends ZodRawShape>(
  schema: ZodObject<TShape>,
  initialValue: SchemaInput<TShape>,
  options?: AbstractControlOptions
): FormGroup<SchemaControls<TShape>> {
  const shape: ZodRawShape = schema.shape;
  const seed = initialValue as Record<string, unknown>;
  const controls: Record<string, AbstractControl> = {};
  for (const key of Object.keys(shape)) {
    controls[key] = control(seed[key], { validators: [zodValidator(shape[key])] }).build();
  }

  // The same loop-versus-mapped-type gap `buildControls` has, one level up: the record is
  // only of type `SchemaControls<TShape>` once the last key has been written, and the keys
  // being written are the schema's own. `control` is what keeps `nonNullable` in one place
  // rather than being repeated here.
  return new FormGroup(controls as unknown as SchemaControls<TShape>, options);
}
