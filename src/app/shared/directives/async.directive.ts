import { Directive, TemplateRef, ViewContainerRef, effect, inject, input } from '@angular/core';
import type { EmbeddedViewRef, Signal } from '@angular/core';
import type { AsyncSnapshot } from './async-snapshot';

/**
 * What `*appAsync` puts in scope for the template it renders.
 *
 * `$implicit` is what `let value` binds to. `appAsync` is the same value under the
 * directive's own name, which is what makes `*appAsync="state as value"` work — Angular's
 * microsyntax translates `as` to a context key named after the directive, not to
 * `$implicit`. Both spellings reach the same object; neither copies it.
 */
export interface AsyncLoadedContext<T> {
  readonly $implicit: T;
  readonly appAsync: T;
}

/**
 * Renders the loaded branch of an asynchronous read, with the value typed.
 *
 * ```html
 * <ng-template #skeleton>…</ng-template>
 * <ng-template #failed>Could not load this post.</ng-template>
 *
 * <article *appAsync="post; let post; loading: skeleton; error: failed">
 *   {{ post.title }}
 * </article>
 * ```
 *
 * The input is a `Signal<AsyncSnapshot<T>>` — build it with `resourceSnapshot()` or
 * `querySnapshot()` — and the directive renders exactly one of three things: the host
 * template with the value in scope, the `loading` template, or the `error` template.
 *
 * ## The template type guard
 *
 * `ngTemplateContextGuard` is the only reason `post` above is a `Post` and not `any`.
 * Under `strictTemplates` Angular type-checks a structural directive's `let-` variables
 * against the context type this static method asserts, and falls back to `any` when a
 * directive does not declare one — silently. That fallback is worth naming, because it is
 * the failure this whole file exists to prevent: a template that renamed a field, or read
 * one that only exists while loading, would compile and then render `undefined` into the
 * page. With the guard, `{{ post.titel }}` is a build error.
 *
 * The guard's body is `return true`. It is not a runtime check and cannot be one — the
 * directive has already decided, from the snapshot's `kind`, that this template is the one
 * to render, and the compiler only ever calls this signature, never this code.
 *
 * Its sibling `ngTemplateGuard_appAsync` — the form that narrows the *bound expression*
 * rather than the context, the way `NgIf` turns `user: User | null` into `User` inside its
 * own template — is deliberately absent. There is nothing here to narrow: the binding is a
 * signal of a union, and the branch that survives is a property of the snapshot the
 * directive read, not of the expression the caller wrote. `@if (x; as y)` covers the case
 * that form was invented for, natively and without a directive.
 *
 * ## What the `loading` and `error` templates get
 *
 * Nothing. Both are `TemplateRef<void>`, and that is a limit rather than an oversight:
 * Angular type-checks an `<ng-template>`'s context from the directives applied to *it*, and
 * a template passed to another directive as an input has none — its `let-` variables are
 * `any` whatever `TemplateRef<C>` claims. Publishing the error through that channel would
 * hand back exactly the untyped value the context guard above was written to remove. A
 * view that needs the error message has the snapshot signal already and can read it in the
 * component, where the union still discriminates.
 *
 * See [`docs/structural-directives.md`](../../../../docs/structural-directives.md).
 */
@Directive({
  selector: '[appAsync]',
})
export class AsyncDirective<T> {
  /** The read to render. Build it with `resourceSnapshot()` or `querySnapshot()`. */
  readonly state = input.required<Signal<AsyncSnapshot<T>>>({ alias: 'appAsync' });

  /** Rendered while the read has neither a value nor an error. Omit to render nothing. */
  readonly loadingTemplate = input<TemplateRef<void> | null>(null, { alias: 'appAsyncLoading' });

  /** Rendered when the read failed. Omit to render nothing. */
  readonly errorTemplate = input<TemplateRef<void> | null>(null, { alias: 'appAsyncError' });

  private readonly container = inject(ViewContainerRef);
  private readonly loadedTemplate: TemplateRef<AsyncLoadedContext<T>> = inject(TemplateRef);

  /**
   * The context object handed to the loaded view, and afterwards mutated in place.
   *
   * Mutable and nullable where `AsyncLoadedContext` is neither: the view holds this exact
   * object, so writing to it is how a new value reaches the template, and there is no
   * honest value to give `$implicit` before the first one arrives. Angular's own `NgIf`
   * initialises the equivalent field to `null!`; a nullable field costs one check and
   * asserts nothing that is not true.
   */
  private context: { $implicit: T; appAsync: T } | null = null;

  private renderedKind: 'loading' | 'error' | 'value' | 'none' = 'none';
  private renderedTemplate: TemplateRef<void> | null = null;
  private loadedView: EmbeddedViewRef<AsyncLoadedContext<T>> | null = null;

  static ngTemplateContextGuard<T>(
    _directive: AsyncDirective<T>,
    _context: unknown
  ): _context is AsyncLoadedContext<T> {
    return true;
  }

  constructor() {
    effect(() => {
      this.render(this.state()());
    });
  }

  private render(snapshot: AsyncSnapshot<T>): void {
    if (snapshot.kind === 'value') {
      this.renderValue(snapshot.value);
      return;
    }

    // Only the branch in play is read, so swapping the `error` template while the view is
    // loading does not tear the skeleton down and put an identical one back.
    const template = snapshot.kind === 'loading' ? this.loadingTemplate() : this.errorTemplate();

    if (this.renderedKind === snapshot.kind && this.renderedTemplate === template) {
      return;
    }

    this.container.clear();
    this.context = null;
    this.loadedView = null;
    this.renderedKind = snapshot.kind;
    this.renderedTemplate = template;

    if (template !== null) {
      this.container.createEmbeddedView(template);
    }
  }

  private renderValue(value: T): void {
    if (this.loadedView !== null && this.context !== null) {
      // The view survives a new value on purpose: recreating it would reset every piece of
      // DOM state the user owns — scroll position, focus, an open `<details>` — on a
      // refetch that changed one field. The view holds this very context object, so the
      // write below *is* the update; what the view lacks is a reason to re-read it, since
      // context properties are not signals and nothing notified the scheduler.
      this.context.$implicit = value;
      this.context.appAsync = value;
      this.loadedView.markForCheck();
      return;
    }

    this.container.clear();
    this.renderedKind = 'value';
    this.renderedTemplate = null;
    this.context = { $implicit: value, appAsync: value };
    this.loadedView = this.container.createEmbeddedView(this.loadedTemplate, this.context);
  }
}
