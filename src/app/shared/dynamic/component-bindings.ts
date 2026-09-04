import type {
  Binding,
  ComponentRef,
  InputSignalWithTransform,
  ModelSignal,
  OutputRef,
  Type,
  ViewContainerRef,
  WritableSignal,
} from '@angular/core';
import { inputBinding, outputBinding, reflectComponentType, twoWayBinding } from '@angular/core';

/**
 * Typed bindings for components created at runtime.
 *
 * `ViewContainerRef.createComponent(Cmp, { bindings })` is the Angular 22 way to render a
 * component the template does not name, and `inputBinding`/`outputBinding`/`twoWayBinding`
 * are how values reach it. All three take the target's name as a plain `string` and its
 * value as `() => unknown`, so nothing checks that the input exists on the component or
 * that the value is the type it accepts. `ComponentRef.setInput(name: string, value: unknown)`
 * has the same hole, one call at a time.
 *
 * The gap is not hypothetical. Renaming an input, changing its type, or mistyping its name
 * all compile, and the failure surfaces as an input that silently keeps its default — or,
 * for a name that matches nothing, as NG0303 in dev mode and nothing at all in production.
 *
 * `ComponentBinder<C>` closes it: the name is `keyof` the component's inputs, the value is
 * that input's write type, and the resulting `TypedBinding<C>` cannot be handed to a
 * different component's `createComponent` call.
 */

declare const COMPONENT_BRAND: unique symbol;

/**
 * A `Binding` that remembers which component it was built for.
 *
 * The brand is a function *taking* `C` so the type is contravariant: `TypedBinding<StatWidget>`
 * is not assignable to `TypedBinding<ActivityWidget>` in either direction, which is the whole
 * point. It is optional so the `Binding` values Angular returns satisfy it without a cast.
 */
export interface TypedBinding<C> extends Binding {
  readonly [COMPONENT_BRAND]?: (component: C) => void;
}

/** The write type of a signal input — the transform's input type when it has one. */
type InputWriteType<S> =
  S extends InputSignalWithTransform<infer _Read, infer Write> ? Write : never;

/** The value type of a `model()`. */
type ModelValueType<S> = S extends ModelSignal<infer T> ? T : never;

/** The event type of an `output()`. */
type OutputEventType<S> = S extends OutputRef<infer T> ? T : never;

type SignalInputKeys<C> = {
  [K in keyof C]-?: C[K] extends InputSignalWithTransform<infer _Read, infer _Write> ? K : never;
}[keyof C];

type ModelKeys<C> = {
  [K in keyof C]-?: C[K] extends ModelSignal<infer _Value> ? K : never;
}[keyof C];

/**
 * `ModelSignal<T>` extends both `InputSignal<T>` and `OutputRef<T>`, so without the second
 * clause every model would also appear here — under the member's own name, while the output
 * Angular actually registers is `${name}Change`. Binding `collapsed` as an output would then
 * typecheck and never fire.
 */
type OutputKeys<C> = {
  [K in keyof C]-?: C[K] extends OutputRef<infer _Event>
    ? C[K] extends InputSignalWithTransform<infer _Read, infer _Write>
      ? never
      : K
    : never;
}[keyof C];

/**
 * The inputs of `C` declared with `input()`, `input.required()` or `model()`, mapped to the
 * type each one accepts. An input with a transform maps to the transform's *input* type, so
 * `limit = input(5, { transform: numberAttribute })` accepts `string | number` here exactly
 * as it does in a template.
 *
 * Inputs declared with the `@Input()` decorator are absent: a decorated field is an ordinary
 * property, indistinguishable at the type level from any other public member, so including
 * them would mean accepting every field as an input name. `input()` is what makes an input
 * visible to the type system — one more reason to prefer it.
 */
export type ComponentInputs<C> = { [K in SignalInputKeys<C>]: InputWriteType<C[K]> };

/** The two-way bindable members of `C` — those declared with `model()`. */
export type ComponentModels<C> = { [K in ModelKeys<C>]: ModelValueType<C[K]> };

/** The outputs of `C` declared with `output()`, mapped to the type each one emits. */
export type ComponentOutputs<C> = { [K in OutputKeys<C>]: OutputEventType<C[K]> };

/** Builds bindings for one component type. Handed to the callback of `dynamicComponent()`. */
export interface ComponentBinder<C> {
  /**
   * One-way input binding. `value` is re-read whenever a signal it touches changes, so a
   * component rendered this way tracks its source without anyone calling `setInput`.
   */
  input<K extends keyof ComponentInputs<C> & string>(
    name: K,
    value: () => ComponentInputs<C>[K]
  ): TypedBinding<C>;

  /** Output binding. `listener` receives exactly what the output emits. */
  output<K extends keyof ComponentOutputs<C> & string>(
    name: K,
    listener: (event: ComponentOutputs<C>[K]) => void
  ): TypedBinding<C>;

  /** Two-way binding to a `model()`. The signal is both the source and the destination. */
  model<K extends keyof ComponentModels<C> & string>(
    name: K,
    value: WritableSignal<ComponentModels<C>[K]>
  ): TypedBinding<C>;
}

/**
 * A component and the bindings to render it with, ready to hand to `DynamicOutletDirective`.
 *
 * The component type is erased. It cannot be kept: `type` needs `C` covariantly and `bindings`
 * needs it contravariantly, so no single parameter lets `DynamicComponent<StatWidget>` and
 * `DynamicComponent<ActivityWidget>` sit in one array. `dynamicComponent()` is the only way to
 * build one and it checks both ends against the same `C`, so the erasure happens where it is
 * sound — after the names and value types have been checked, not before.
 */
export interface DynamicComponent {
  readonly type: Type<unknown>;
  readonly bindings: readonly Binding[];
}

/**
 * What the compiler cannot check, checked at construction.
 *
 * `ComponentBinder` types names against the component's *class members*, but `inputBinding`
 * and friends take the *public* name — the alias when the input declares one. An aliased
 * input therefore typechecks under its member name and binds nothing. So does an `@Input()`
 * field, which `ComponentInputs` cannot see at all and which no type argument constrains.
 *
 * `reflectComponentType` is Angular's public reflection API and knows both names, so one
 * lookup per component turns both mistakes into an error naming the input that was meant and
 * the ones that exist. The check runs in production too: a binding whose name matches nothing
 * is a bug in every environment, and failing at the point of construction beats an input that
 * silently keeps its default.
 */
function createBinder<C>(type: Type<C>): ComponentBinder<C> {
  const mirror = reflectComponentType(type);
  if (mirror === null) {
    throw new Error(
      `${type.name} is not a component. dynamicComponent() and createDynamicComponent() ` +
        `render components; a directive, pipe or plain class has no view to create.`
    );
  }

  const publicNames = (members: readonly { readonly templateName: string }[]): string =>
    members.length === 0 ? '(none)' : members.map((m) => `"${m.templateName}"`).join(', ');

  const requireInput = (name: string): void => {
    if (!mirror.inputs.some((i) => i.templateName === name)) {
      throw new Error(
        `${mirror.selector} has no input "${name}". Its inputs are: ${publicNames(mirror.inputs)}. ` +
          `An aliased input binds under its alias, not its class member name.`
      );
    }
  };

  const requireOutput = (name: string): void => {
    if (!mirror.outputs.some((o) => o.templateName === name)) {
      throw new Error(
        `${mirror.selector} has no output "${name}". Its outputs are: ${publicNames(mirror.outputs)}.`
      );
    }
  };

  return {
    input(name, value) {
      requireInput(name);
      return inputBinding(name, value);
    },
    output(name, listener) {
      requireOutput(name);
      return outputBinding(name, listener);
    },
    model(name, value) {
      requireInput(name);
      // A `model()` is an input plus a `${name}Change` output; `twoWayBinding` registers both.
      requireOutput(`${name}Change`);
      // `twoWayBinding` declares `WritableSignal<unknown>`, which no concrete
      // `WritableSignal<T>` satisfies — `set(value: T)` cannot accept an `unknown`. The
      // signal is only ever read and written by the component whose model it is bound to,
      // and `ComponentModels<C>[K]` has already tied its type to that model's.
      return twoWayBinding(name, value as WritableSignal<unknown>);
    },
  };
}

/**
 * Describe a component to render dynamically.
 *
 * ```ts
 * dynamicComponent(StatWidgetComponent, (bind) => [
 *   bind.input('label', () => 'Revenue'),
 *   bind.input('value', this.revenue),
 *   bind.model('collapsed', this.collapsed),
 *   bind.output('select', (id) => this.open(id)),
 * ]);
 * ```
 *
 * The result is a value, not a rendering: nothing is created until it reaches a
 * `[appDynamicOutlet]`. Hold it in a field or a `computed()` — the outlet recreates the
 * component whenever the descriptor's *reference* changes, so one built inline in a template
 * is a new descriptor on every change-detection pass and a component that loses its state.
 */
export function dynamicComponent<C>(
  type: Type<C>,
  bind: (binder: ComponentBinder<C>) => readonly TypedBinding<C>[]
): DynamicComponent {
  return { type, bindings: bind(createBinder(type)) };
}

/**
 * Create a component in `container` with typed bindings, returning its `ComponentRef<C>`.
 *
 * The imperative counterpart of `dynamicComponent()`, for code that needs the instance back —
 * a dialog service handing out a `ComponentRef`, a test creating a subject directly. Unlike
 * the descriptor this keeps `C`, because a single call has only one component type to track.
 *
 * The caller owns the result: `ComponentRef.destroy()`, or `container.clear()`, or letting the
 * view that owns the container be destroyed.
 */
export function createDynamicComponent<C>(
  container: ViewContainerRef,
  type: Type<C>,
  bind: (binder: ComponentBinder<C>) => readonly TypedBinding<C>[],
  options: { readonly index?: number } = {}
): ComponentRef<C> {
  return container.createComponent(type, {
    index: options.index,
    bindings: [...bind(createBinder(type))],
  });
}
