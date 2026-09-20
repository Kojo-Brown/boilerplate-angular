/**
 * Compile-time assertions, for the things a runtime expectation cannot reach.
 *
 * A typed form's whole product is types. `expect(form.getRawValue()).toEqual({…})` passes
 * identically whether `getRawValue()` is typed `LoginFormData`, `Partial<LoginFormData>`,
 * `{ email: string | null }` or `any` — the values are the same in all four, and three of
 * them are the bugs. So the assertions here run in `tsc`, and the only thing left for
 * Karma to do is prove the file compiled.
 *
 * These live in `src/testing/` rather than beside the helpers because
 * `tsconfig.app.json` excludes both, and a type test belongs in the build that runs
 * tests: a broken assertion has to fail `pnpm test`, which compiles the specs, rather
 * than only `pnpm build`.
 */

/**
 * `true` only when the two types are identical — not merely mutually assignable.
 *
 * The naive `TLeft extends TRight ? TRight extends TLeft ? true : false : false` is not
 * good enough here: it reports `any` as equal to everything, which is exactly the
 * degenerate case a form's type test exists to catch, and it distributes over unions so
 * `'a' | 'b'` compares equal to `'a'`. Comparing two identical *deferred* conditional
 * types instead makes the compiler's internal identity relation observable, which is
 * strict enough to tell `string` from `string | null` and either from `any`.
 */
export type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;

/**
 * Fails to compile unless `TActual` is exactly `TExpected`.
 *
 * ```ts
 * expectTypeEquals<LoginFormData, ReturnType<typeof form.getRawValue>>(true);
 * ```
 *
 * The `true` argument is what produces the diagnostic: when the types differ the
 * parameter's type collapses to `never`, and the error lands on the call rather than
 * somewhere inside a type alias.
 */
export function expectTypeEquals<TExpected, TActual>(
  _proof: Equals<TExpected, TActual> extends true ? true : never
): void {
  // Intentionally empty: the assertion is the signature.
}
