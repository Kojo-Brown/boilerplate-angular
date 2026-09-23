# Async cross-field validation

A rule that (a) needs the server to settle it and (b) reads more than one control is the
hardest shape a reactive form has. Angular supports both halves, and the way they compose
is where the traps are. `src/app/core/forms/async-cross-field.ts` is two functions:
`asyncCrossFieldValidator`, which handles the request, and `revalidateWhen`, which handles
the dependency. `RegisterComponent` uses both to check a workspace invite code against the
email address it was issued to.

## The shape of the problem

```
inviteCode ─┐
            ├─► POST /auth/invites/check ─► "that code was issued to another address"
email ──────┘
```

Neither field can answer this on its own, and neither can the client. Four things have to
be true for it not to be annoying:

1. It must not send a request per keystroke. **Debounce.**
2. An answer about a pair the user has already typed past must never land in the form.
   **Cancellation.**
3. Editing the *email* must re-ask the question, because the standing answer was about a
   different pair. **Declared dependency.**
4. Doing (3) must not undo (1) — every keystroke in `email` now revalidates the code.
   **Memoisation.**

## Where the validator goes, and why not on the group

The obvious home for a cross-field rule is the `FormGroup`, which is where this codebase
puts the synchronous one (`zodGroupValidator(registerSchema)`, for "passwords don't
match"). For an *async* rule it is the wrong place, for a reason that is easy to miss:

> Angular runs a control's async validators only when its synchronous validators pass.

A group's synchronous validator is the whole form. Hang the invite check on the group and
no request is sent until the name, both passwords and the email are all valid and
matching — so the user fills in the entire form, and only then learns the code at the top
does not apply. Hang it on the field instead and it is checked as soon as the field itself
is plausible, with `control.parent` supplying the rest of the key:

```ts
inviteCode.addAsyncValidators(
  asyncCrossFieldValidator(
    inviteKey, // (control) => { email, code } | null
    (key) => this.invites.check(key.email, key.code).pipe(map(toInviteErrors)),
    { equal: (a, b) => a.email === b.email && a.code === b.code }
  )
);
```

The cost of moving it down is that Angular no longer knows the field depends on its
sibling. That is what `revalidateWhen` pays back.

## Debounce and cancellation are the same mechanism

There is no long-lived stream to attach `debounceTime` to. Angular calls an async
validator afresh on each revalidation and subscribes to whatever it returns, so the only
place a delay can live is *inside* the returned Observable:

```ts
return timer(debounceMs).pipe(switchMap(() => check(key)), take(1));
```

That placement is what makes cancellation work, and the two are not separable.
`AbstractControl.updateValueAndValidity()` unsubscribes the previous async validation run
before starting the next one. Unsubscribing tears down whatever that run was doing — a
`timer` that has not fired yet, or an `HttpClient` request already in flight, which is
aborted. A debounce applied anywhere else (around the caller, or by deferring the
`addAsyncValidators` call) is invisible to that mechanism, and leaves superseded requests
running to land into a form that has moved on.

`async-cross-field.spec.ts` asserts the abort against a real `HttpTestingController`,
where `TestRequest.cancelled` can say so:

```ts
const first = httpMock.expectOne('/invites/check');
pair.code.setValue('WS-2');
expect(first.cancelled).toBeTrue();
```

## `take(1)`, or the form that can never be submitted

A control stays `PENDING` until its async validator's Observable **completes**. Emitting
is not enough, and `status` is what `form.valid`, `form.invalid` and every disabled submit
button read.

`HttpClient` completes after one response, which is exactly why this bug hides: the form
works against the real transport and hangs against anything that stays open — a
`BehaviorSubject` in a spec, a `toObservable` bridge, a check built on a signal. The
`take(1)` lives inside `asyncCrossFieldValidator` so no caller has to remember it, and the
spec pins it with a `Subject` that emits and never completes.

## `pending` is neither valid nor invalid

The other half of the same fact. This guard is not enough:

```ts
if (this.form.invalid) return; // ← submits while the invite check is still in flight
```

A pending form's `invalid` is `false`. The submit handler has to say so explicitly:

```ts
if (this.form.pending || this.form.invalid) return;
```

The disabled button covers the common path; this covers the rest.

## Declaring the dependency

Reactive forms revalidate a control when *that* control changes. A validator that reads a
sibling therefore ends up holding a verdict about a value it can no longer see: correct
the email and the "not valid for this address" message stays, and the form stays invalid,
until the code itself is touched.

```ts
revalidateWhen(inviteCode, [this.form.controls.email]);
```

It subscribes to each source's `valueChanges` and calls `target.updateValueAndValidity()`,
torn down with the owning injector. A source that is the target or one of its **ancestors**
is refused: revalidating a control updates its ancestors, whose `valueChanges` would feed
straight back in. That loop presents as a frozen tab rather than as a stack overflow,
because each turn is scheduled rather than recursive, so it is worth a guard rather than a
comment.

## Why the cache is not an optimisation

`revalidateWhen` turns every keystroke in `email` into a revalidation of `inviteCode`.
Without memoisation that is a request per keystroke in *two* fields instead of one — worse
than the problem the debounce was added to solve.

So `keyOf` projects the control onto just the part the check depends on, and settled
answers are kept in a bounded, insertion-ordered list:

- A key that has not changed is answered **synchronously**, from the cache. The control
  never enters `PENDING`, so nothing flickers and no timer is armed.
- A key of `null` means "not worth asking" — an empty optional field, or an email the
  schema itself would reject. No error, no request.
- The comparison is `Object.is` by default, which is right for a string key and wrong for
  an object one. A composite key needs either a string spelling or an `equal`; without one
  the cache never hits and the memoisation silently does nothing.
- A **failure is never memoised**. `catchError` sits after the `tap` that records the
  answer, so the next edit that produces the same pair tries again rather than inheriting
  a verdict the server never gave.

## Failing open

The default when `check` errors is `null` — no error. A validator standing in front of a
network that reports `{ unreachable: true }` on a timeout has turned an availability blip
into a lost sign-up, and it has not prevented anything: the server still rejects at submit
whatever it was going to reject. `onFailure` takes an errors object for the rarer rule
where letting a value through is the more expensive mistake.

## Rendering the result

The invite field's message is gated on `dirty`, not on `touched` like every other field on
the page. The others report a rule the user could have read off the label, so waiting for
blur keeps an untouched form quiet. This one reports the server's answer to a question only
typing could have raised, and the answer arrives while the caret is still in the field.
`touched` is still honoured, so submitting an untouched form surfaces it too.

While the check is outstanding the field shows `Checking invite code…` and the submit
button is disabled, both read off `controlSignal(...).pending` — see
[`docs/rxjs-interop.md`](./rxjs-interop.md) for why a reactive-forms control needs
`toSignal` to be visible to the reactive graph at all. Under zoneless change detection an
async validator settling is precisely the case a template getter would miss: nothing about
it arrives through a bound host listener.

## When not to reach for this

- **One field, one rule** — a plain `AsyncValidatorFn` with the same `timer` + `take(1)`
  shape is enough. The key projection and `revalidateWhen` are only worth it when a second
  control is involved.
- **A search box** — that is [`typeahead`](../src/app/core/reactivity/typeahead.ts), which
  is a stream with `switchMap` rather than a validator, because its result is a list to
  render and not a verdict that blocks submission. See
  [`docs/rxjs-flattening.md`](./rxjs-flattening.md).
- **A rule the client can settle** — keep it synchronous. "Passwords don't match" is a Zod
  refinement on the group; a round trip for it would be slower and no more correct.
