# Custom form controls: `ControlValueAccessor`, with the validation half

A `ControlValueAccessor` is how a component becomes something `formControlName` can point
at. Angular's own documentation covers the value: `writeValue` in, `registerOnChange` out,
`registerOnTouched` on the way past, `setDisabledState` when the form says so.

What it does not cover is that **a value accessor is told the value and nothing else**.
It does not learn that its control is invalid, that it has been touched, what the errors
say, or whether the rule it is failing is one it could have enforced itself. Both of those
gaps have an answer in the framework; neither is obvious, and they interact.

This is the map. The code is
[`src/app/core/forms/host-control.ts`](../src/app/core/forms/host-control.ts),
[`src/app/core/forms/error-messages.ts`](../src/app/core/forms/error-messages.ts),
[`src/app/shared/ui/input/input.component.ts`](../src/app/shared/ui/input/input.component.ts)
(consumes validity) and
[`src/app/shared/ui/tag-input/tag-input.component.ts`](../src/app/shared/ui/tag-input/tag-input.component.ts)
(consumes *and* contributes).

---

## 1. The `error` input is the smell

Nearly every custom input in nearly every codebase looks like this:

```html
<app-input label="Email" [error]="emailError()" formControlName="email" />
```

It compiles, it renders, and it is wrong in the ways nothing catches:

- the binding can name a different field's error signal — same type, no complaint;
- it can be left off entirely, and the field simply never reports anything;
- a message that arrives from somewhere other than a template — `setErrors` from a server
  response, an async validator settling, `markAllAsTouched` on submit — only reaches the
  input if the page thought to wire that too;
- `aria-invalid` and the red border are usually bound separately, so the three can
  disagree.

All of it is a form handing a component something the control it is *already bound to*
knows better. `hostControl()` goes and reads it instead, and the three bindings collapse
into one signal.

## 2. Reading the control means not injecting `NgControl`

The obvious implementation does not work:

```ts
@Component({
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => Field), multi: true }],
})
export class Field {
  private readonly ngControl = inject(NgControl); // 💥
}
```

```
NG0200: Circular dependency detected for `Field`.
Path: Field -> unknown -> FormControlName -> InjectionToken NgValueAccessor -> Field
```

The component provides `NG_VALUE_ACCESSOR` on itself, and the form directive *injects*
that token from the element they share. Asking for the directive from the constructor asks
for something halfway through being built.

The workaround everyone reaches for is to drop the provider and assign the accessor by
hand:

```ts
constructor() {
  const ngControl = inject(NgControl, { self: true, optional: true });
  if (ngControl !== null) ngControl.valueAccessor = this;
}
```

That is a fine answer for an accessor that only *reads* validity. It does not extend to
one that contributes any: there is no `ngControl.validator = this` to assign, and a
component that provides `NG_VALIDATORS` and injects `NgControl` lands on NG0200 again by
the second path. Both are asserted in
[`host-control.spec.ts`](../src/app/core/forms/host-control.spec.ts).

So `hostControl()` resolves the directive *after* construction, and both providers stay
declarative.

## 3. `ngOnInit` is too early — in one of the two binding syntaxes

This is the part that bites, because it is invisible in half the fixtures anyone writes.

| Hook | `[formControl]` | `formControlName` |
| --- | --- | --- |
| constructor | NG0200 | NG0200 |
| `ngOnInit` | control | **`null`** |
| `writeValue` | control | control |
| `ngAfterViewInit` | control | control |

`FormControlDirective` takes its control as an `@Input`, so it is set before any hook runs.
`FormControlName` has no such input — it looks its control up out of the parent
`FormGroupDirective` in its own `ngOnChanges`, which runs *after* the hooks of the
component sharing its element. A component written and specced against `[formControl]`
therefore renders no validation state at all in the forms that use `formControlName`,
which is most of them, with nothing failing anywhere.

`writeValue` is the earliest hook both syntaxes agree on: `setUpControl` calls it, and it
calls it *after* binding the control. It is also still before the accessor's first render,
so there is no second change-detection pass and nothing for a fixture's `checkNoChanges`
to object to. Hence:

```ts
writeValue(value: string | null): void {
  this.field.connect();   // ← first line
  this.value.set(value ?? '');
}
```

`connect()` is idempotent, and a no-op when there is no control at all — the component
stays usable outside a form.

The lookup passes `self: true`, which is load-bearing: the element-injector chain reaches
ancestor elements, so a field rendered inside another accessor's template would otherwise
bind to *that* accessor's control and report its errors under its own label.

## 4. Turning `ValidationErrors` into a sentence

`{ minlength: { requiredLength: 8, actualLength: 3 } }` is a fact about a control, not
something to show anybody. `FIELD_ERROR_MESSAGES` maps keys to messages and is an
injection token so localisation can replace it at the root and one route can narrow it.

Two things it fixes beyond the obvious:

- **Which error, when there are several.** A control fails every validator it fails, so
  `Object.keys(errors)[0]` is the order the validators were *declared* in — reordering an
  array silently changes the message. `resolveFieldError` ranks them, `required` first.
- **Messages a component contributes itself.** A tag editor's `tagsPending` message
  belongs next to the validator that produces it, not in an application-wide map that
  every consumer has to know to extend. Components pass their own map to `hostControl`,
  which layers it over the injected one.

`zod` passes straight through: `zodValidator` stores the schema's own message, written
next to the rule. See [`typed-forms.md`](./typed-forms.md).

## 5. Contributing validity: `NG_VALIDATORS`

The half people skip. A composite accessor often knows something about its own state that
*no outer validator can see*, because it is not in the value.

The tag editor is the smallest honest example. Its text box is not part of its value:

> Type `angular`, do not press Enter, submit. The control's value is `[]`, every validator
> agrees the field is fine, and the visitor watches the word they typed disappear.

Nothing above the component can detect that. So the buffer is reported as `tagsPending`
through `NG_VALIDATORS`, and the form will not submit while it sits there. (Committing on
blur is the other answer, and it is worse: it turns a half-typed word someone was about to
delete into a permanent tag, silently.)

`minTags`/`maxTags` are validators for a different reason: the component refuses to *add*
past the ceiling, but a value can also arrive through `writeValue` from a resolver, a
restored draft or a server response — and silently truncating someone else's data is worse
than reporting it. The component never creates a value outside its bounds and always
reports one it was handed.

### `registerOnValidatorChange`, the hook nobody implements

Angular re-runs a validator when the control's **value** changes. A bound *rule* changing
is invisible to it:

```ts
// maxTags: 2, value: ['a','b','c'] → { tagsMax: … }
component.maxTags.set(5);
// still { tagsMax: … }. The control was never asked again.
```

`registerOnValidatorChange` hands the accessor the callback that invalidates the verdict,
and the accessor is the only thing that knows when to call it. In the tag editor that is an
`effect` over the two bounds, plus a direct call whenever the buffer changes.

The `untracked` around the callback is not decoration: it runs `updateValueAndValidity`
synchronously, which calls the component's own `validate`, so without it every signal
`validate` reads becomes a dependency of the effect.

## 6. Focus, for a composite accessor

Three things a single `<input>` accessor never has to think about:

- **`blur` does not bubble.** A host listener never hears the inner input lose focus.
  `focusout` does.
- **`relatedTarget` decides whether it counts.** Tabbing from the text box to a chip's own
  remove button is not leaving the field; marking the control touched there shows "Add at
  least one tag" at someone in the middle of adding one. (`relatedTarget` is `null` when
  focus leaves the document — switching tab or window — and that *does* count as leaving.)
- **Removing the focused element sends focus to `<body>`.** For a keyboard user the next
  Tab then starts from the top of the page. Focus has to be moved deliberately, after the
  view has been rebuilt.

## 7. The contract, as a test

[`src/testing/value-accessor.ts`](../src/testing/value-accessor.ts) is a conformance suite
any accessor in this repo can be pointed at:

```ts
describe('TagInputComponent as a value accessor', () => {
  itHonoursTheValueAccessorContract<string[]>({ create, written, rendered, edit, … });
});
```

It checks the rules Angular documents and enforces nowhere — a `writeValue` that reports
its own write back, a missing `setDisabledState`, a control marked touched on the first
keystroke, an accessor that never reports being left, one that renders none of its
control's errors — each of which produces a component that works in the demo its author
tried and misbehaves later, quietly.

The checks throw rather than calling `expect`, so
[`value-accessor.spec.ts`](../src/testing/value-accessor.spec.ts) can point each one at an
accessor built to break it and assert that it *fails*. A conformance suite that has stopped
conforming to anything passes exactly like one that works.

Call it from a `describe` of its own: every check builds its own fixture, and
`TestBed.configureTestingModule` throws once the testing module has been instantiated.

## When not to write one

A `ControlValueAccessor` is for a component that *is* a form control. If what you have is a
layout around ordinary inputs, use `formControlName` on the inputs and leave the grouping
to a `FormGroup` — a wrapper that exists only to pass a value through adds a value
accessor's whole contract to something that had no need of one.
