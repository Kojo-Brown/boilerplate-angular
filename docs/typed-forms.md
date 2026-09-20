# Typed reactive forms

`src/app/core/forms/` builds a `FormGroup` from the model it is meant to produce, instead
of inferring a model from whatever controls happened to be written.

Angular's forms have been typed since v14 and this is not a workaround for a gap in that.
`FormBuilder.group({ email: [''] })` returns a genuinely typed
`FormGroup<{ email: FormControl<string | null> }>`, `form.controls.email` is a
`FormControl`, and `form.getRawValue()` has a real type. The problem is the **direction**:
those types flow from the spec to the form, so the form is whatever was written and agrees
with itself by construction. Nothing compares it to the interface it exists to fill.

```ts
interface LoginFormData {
  email: string;
  password: string;
}

// Every one of these compiles.
const a = fb.group({ email: [''] }); // password never rendered
const b = fb.group({ email: [''], passwrod: [''] }); // typo; both fields "exist"
const c = fb.group({ email: [''], password: [''] }); // email is `string | null`
```

`a` submits `{ email }` to an endpoint that requires both. `b` renders a control nothing
binds and silently omits the one that matters. `c` is the subtlest and the most common:
`getRawValue()` is `{ email: string | null; password: string | null }`, so every handoff
to `LoginFormData` needs a cast, a re-parse, or a `!`. All three render correctly, pass
every assertion a form spec normally contains, and fail at the API boundary or not at all.

## `typedGroup`

```ts
import { control, typedGroup } from '@/app/core/forms';

const form = typedGroup<LoginFormData>()({
  email: control(''),
  password: control(''),
});

form.getRawValue(); // LoginFormData
form.controls.email; // FormControl<string>
```

The model is now an input. The spec is checked against it — every field present, no field
extra, each control holding exactly the field's type — while the _controls_ are still
inferred from the spec, so `form.controls.email` keeps its precise type and nothing
downstream (`[formGroup]`, `AbstractControl.events`, `controlErrorSignal`) can tell the
difference. What comes back is an ordinary `FormGroup`; there is no wrapper class.

### Why the empty `()`

TypeScript has no partial type-argument inference. `typedGroup<LoginFormData>({ … })` would
have to pin `TValue` and infer `TSpec` from the same argument list, and supplying one type
argument means supplying both — the spec's type would have to be written out by hand,
which is the thing being inferred. Returning a second generic function splits the two
inference sites. The empty parentheses are that split.

## `control` and `nonNullable`

`control(initialValue)` is the only way to put a field in a spec, and it always builds a
`nonNullable` control.

`nonNullable` is not a strictness preference. It is a statement about what `reset()` does:
a control built without it resets to `null`, which is why `new FormControl('')` is typed
`FormControl<string | null>` — the type is honest, not over-cautious. So a "clear the
form" button on a nullable control writes `null` into a field the template binds and the
schema then rejects with _Expected string, received null_, in a field the visitor never
touched. With `nonNullable`, `reset()` restores the initial value and the `| null`
disappears from the type because it has disappeared from the behaviour.

That is also why the initial value is a required argument: with `nonNullable` the initial
value is the reset value, so there is no such thing as a control without one.

A field that genuinely holds nothing asks for it — `control<string | null>(null)` — and
its model property must say so too.

## Nesting and arrays

```ts
const form = typedGroup<Profile>()({
  name: control(''),
  address: nestedGroup<Profile['address']>()({ city: control(''), postcode: control('') }),
  tags: arrayOf<string>()([control('owner')]),
});

form.controls.address.controls.city; // FormControl<string>
form.getRawValue(); // Profile, all the way down
```

`nestedGroup` is `typedGroup` one level down — the same checking against the same kind of
model. `arrayOf` takes specs rather than controls for the reason the group does: an array
of `new FormControl('')` is an array of _nullable_ controls, and
`FormArray<FormControl<string | null>>` has a raw value of `(string | null)[]`.

## Schema-driven forms: `schemaGroup`

Every form in this application is backed by a Zod schema, and wiring
`zodValidator(schema.shape.email)` per field by hand is the other half of the same drift.
`typedGroup` reports a _missing_ control, but a field wired to the wrong sibling's rule, or
to none at all, is a form that shows no error and submits values the server rejects.

```ts
const form = schemaGroup(loginSchema, { email: '', password: '' });
```

One control per key of the schema, each carrying that key's own rule, each non-nullable,
all typed. Flat schemas only, and deliberately: a nested `z.object()` field would produce a
`FormControl` holding an object — well-typed, correctly validated, and not the form anyone
wanted. Compose `typedGroup` with `nestedGroup` for that; a schema is one field's
validator, not the form's structure.

Cross-field rules stay on the group, because that is what they are about:

```ts
schemaGroup(registerBaseSchema, initial, { validators: zodGroupValidator(registerSchema) });
```

The _base_ schema, not the refined one: `.refine()` returns a `ZodEffects`, which has no
`.shape` to read. The split is not an accident of Zod's API — it is the same split the
template makes, where three messages render under their own input and "passwords don't
match" belongs to the pair.

### `z.input`, not `z.infer`

`z.infer` is a schema's **output** type. A form holds its **input**.

For `loginSchema` the two coincide, which is why `onSubmit`'s `safeParse` can look like
redundant re-validation. Add one transform and they part company:

```ts
const ageSchema = z.object({ age: z.string().regex(/^\d+$/).transform(Number) });
// z.infer → { age: number }     ← a FormControl<number> bound to a text input
// z.input  → { age: string }    ← what the visitor is actually typing
```

`schemaGroup` types the controls on the input side, so `getRawValue()` returns what was
typed and `safeParse` is what crosses to the output type. Keeping the parse is therefore
not belt-and-braces: it is the only thing that makes "these two types coincide" a checked
fact rather than an assumption that holds until someone adds a `.transform()`. The group's
validity is a separate claim — it says each field satisfies its own rule, not that the
object satisfies the schema.

## `value` is not the form's value

`form.value` is `Partial<T>`, at runtime and in the type, because a disabled control is
omitted from it. `getRawValue()` is the complete read and the one to submit. This is
Angular's behaviour, unchanged here; `partial-value.ts` in the fixtures is the type error
that says so.

## What holds this up

The product of this module is types, so the tests are type tests.

**Positive**, in the specs, via `expectTypeEquals` from `src/testing/types.ts`:

```ts
expectTypeEquals<LoginFormData, ReturnType<typeof form.getRawValue>>(true);
```

It uses the deferred-conditional identity trick rather than mutual assignability, because
the naive version reports `any` as equal to everything — and `any` creeping into a form's
value type is precisely the degenerate case being guarded against. These compile as part of
`pnpm test`, so a broken assertion fails the test run.

**Negative**, in `scripts/ci/fixtures/form-types/`, checked by `pnpm check:form-types`. Code
that does not compile cannot live in a spec, so each fixture is a file that is _supposed_ to
fail, annotated with the diagnostic it must produce:

```ts
// @expect-error TS2322: Type 'string | null' is not assignable to type 'string'
email: control<string | null>(null),
```

The gate compiles them, matches every diagnostic against an annotation, and fails on an
unannotated error as well as on a missing one. `@ts-expect-error` would be most of this for
free, but it accepts _any_ error on the line: a fixture that had drifted into a typo or an
unresolved import would still satisfy it while testing nothing. These failures are
near-misses by construction, so "it errored for that reason" is the whole claim.

| Fixture                      | Rejects                                       |
| ---------------------------- | --------------------------------------------- |
| `missing-field.ts`           | a model field with no control                 |
| `extra-field.ts`             | a control the model has no room for           |
| `wrong-value-type.ts`        | a control whose value type is not the field's |
| `bare-control.ts`            | a raw `FormControl` where a spec belongs      |
| `nullable-control.ts`        | a nullable control in a non-nullable field    |
| `partial-value.ts`           | `form.value` read as the whole model          |
| `nested-group-model.ts`      | a nested group built for the wrong model      |
| `array-item-type.ts`         | a `FormArray` of the wrong item type          |
| `schema-initial-value.ts`    | a schema-driven form with an incomplete seed  |
| `schema-input-not-output.ts` | `getRawValue()` read as the schema's output   |

## The phantom, and why it is there

`FieldSpec<TControl, TRaw>` carries a `rawValue: (raw: TRaw) => TRaw` that is never called.

Angular's control classes expose their value type through `value`, `setValue` and
`patchValue` — a property and two **methods** — and methods are compared bivariantly. So a
`FormControl<string | null>` satisfies a slot asking for `AbstractControl<unknown, string>`:
`setValue` is checked in both directions and `string` is assignable to `string | null` in
one of them. A purely structural constraint therefore cannot see the one mistake this
module exists to prevent.

A function **property** is contravariant in its parameter and covariant in its return, so
naming `TRaw` in both positions makes it invariant under `strictFunctionTypes`, and a spec
whose raw value is wider or narrower than its field fails in one direction or the other.
`nullable-control.ts` is that assertion; deleting the phantom makes that fixture compile
and the gate reports it.

It costs one ergonomic wart. For a field typed as a union of literals the initial value
alone infers too wide — `control('on')` is a spec for `string`, not for `'on' | 'off'` — so
the type argument has to be written: `control<'on' | 'off'>('on')`. Contextual inference
does not reach through, and relaxing the phantom to a covariant `() => TRaw` would fix it
at the cost of the nullable check, which is not a trade worth making.

## Measured cost

Nothing, and a little less than nothing.

`/login` and `/register` moved off `FormBuilder` onto `schemaGroup`, which drops
`/register`'s lazy JS from **111.88 kB to 108.22 kB** against its unchanged 114 kB budget.
The cause was checked rather than assumed: re-injecting a single `FormBuilder` into
`RegisterComponent` puts 3.81 kB straight back. `FormBuilder` is a service whose whole job
is a set of inference-friendly overloads, and with nothing injecting it, it and
`NonNullableFormBuilder` tree-shake out of the shared `@angular/forms` + Zod chunk.

`/login` is unchanged at 3.67 kB — its form is deferred, so the saving lands in the
deferred chunk rather than in the route — and the initial bundle is unchanged at 571.42 kB.

## When not to use this

A form with one field and no model does not need a model. `control('').build()` is a
non-nullable `FormControl` and nothing else, and a bare `new FormControl(value, { nonNullable: true })`
is fine where there is no interface for it to drift from. The helpers earn their place the
moment a form feeds a typed payload.
