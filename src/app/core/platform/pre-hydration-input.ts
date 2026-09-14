/**
 * Recovering what a visitor typed into a server-rendered form before it was hydrated.
 *
 * ## The defect
 *
 * A prerendered page shows its form immediately — that is the whole reason to prerender
 * it — so a visitor can start typing while the JavaScript is still arriving. When it
 * arrives, `FormControlName.ngOnInit` calls `setUpControl`, which calls
 * `valueAccessor.writeValue(control.value)`: the control's *initial* value, an empty
 * string, written straight over the DOM node the visitor has been typing into.
 *
 * Measured rather than assumed. Against the production build with every script delayed,
 * a value typed into `/register`'s email field was gone 2.5 s later, and `/login`'s at
 * 5.1 s — the difference being that `/login` defers its form's hydration, which widens
 * the window on purpose. Nothing warns; the field simply empties, and only on the slow
 * connections that make prerendering worth doing.
 *
 * Event replay does not cover it and cannot: replay dispatches the captured event after
 * the DOM has already been overwritten, and a value accessor reads `target.value` at
 * dispatch time. `ngSkipHydration` does not either — it destroys the subtree and renders
 * it again, which empties the field by a different route.
 *
 * ## The fix
 *
 * Seed the controls from the DOM instead of writing the DOM from the controls. A
 * component's constructor runs before the `FormControlName` directives in its own
 * template are initialised, and during hydration the server's markup is already in place
 * under the host element — so this is the one moment where the typed value still exists
 * and nothing has decided to replace it yet.
 *
 * ```ts
 * private readonly typed = typedBeforeHydration(inject(ElementRef).nativeElement, [
 *   'email',
 *   'password',
 * ] as const);
 *
 * protected readonly form = this.fb.group({
 *   email: [this.typed.email ?? '', [zodValidator(loginSchema.shape.email)]],
 *   password: [this.typed.password ?? '', [zodValidator(loginSchema.shape.password)]],
 * });
 * ```
 *
 * On a client-rendered visit the host has no children yet, every lookup misses, and the
 * form is seeded with the empty strings it would have had anyway.
 */

/**
 * The values currently in the server-rendered inputs for `controls`, keyed by control name.
 *
 * Only non-empty values are returned, so the caller's `?? ''` default is reached for a
 * field the visitor did not touch rather than being overwritten with an empty string.
 *
 * The lookup is by `formControlName`, not by `id`: it is the attribute that already names
 * the control, so a field cannot be renamed in the template and quietly stop being
 * recovered. Attribute *names* in a selector are matched case-insensitively in an HTML
 * document, which is what makes this find the `formcontrolname="…"` the server writes.
 */
export function typedBeforeHydration<T extends string>(
  host: Element,
  controls: readonly T[]
): Partial<Record<T, string>> {
  const typed: Partial<Record<T, string>> = {};

  for (const control of controls) {
    const input = host.querySelector<HTMLInputElement>(`input[formControlName="${control}"]`);
    const value = input?.value;
    if (value) {
      typed[control] = value;
    }
  }

  return typed;
}
