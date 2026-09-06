import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import type { WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { host, requireEl } from '@/testing';
import type { AsyncSnapshot } from './async-snapshot';
import { AsyncDirective } from './async.directive';

let leavesDestroyed = 0;

/** Renders nothing; it exists so a discarded view can be observed being destroyed. */
@Component({
  selector: 'test-async-leaf',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class AsyncLeafComponent {
  ngOnDestroy(): void {
    leavesDestroyed += 1;
  }
}

interface Row {
  readonly id: string;
  readonly title: string;
}

@Component({
  selector: 'test-async-host',
  standalone: true,
  imports: [AsyncDirective, AsyncLeafComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template #skeleton><p data-testid="skeleton">loading…</p></ng-template>
    <ng-template #failed><p data-testid="error">failed</p></ng-template>

    <section data-testid="loaded" *appAsync="state; let row; loading: skeleton; error: failed">
      <span data-testid="title">{{ row.title }}</span>
      <input data-testid="draft" />
      <test-async-leaf />
    </section>
  `,
})
class AsyncHostComponent {
  readonly state: WritableSignal<AsyncSnapshot<Row>> = signal<AsyncSnapshot<Row>>({
    kind: 'loading',
  });
}

/** The same directive with no alternative templates, and `as` instead of `let`. */
@Component({
  selector: 'test-bare-async-host',
  standalone: true,
  imports: [AsyncDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p data-testid="loaded" *appAsync="state as row">{{ row.title }}</p>`,
})
class BareAsyncHostComponent {
  readonly state: WritableSignal<AsyncSnapshot<Row>> = signal<AsyncSnapshot<Row>>({
    kind: 'loading',
  });
}

const LOADED: AsyncSnapshot<Row> = { kind: 'value', value: { id: 'a', title: 'First' } };

describe('AsyncDirective', () => {
  beforeEach(() => {
    leavesDestroyed = 0;
  });

  function createHost(): ComponentFixture<AsyncHostComponent> {
    TestBed.configureTestingModule({ imports: [AsyncHostComponent] });
    const fixture = TestBed.createComponent(AsyncHostComponent);
    fixture.detectChanges();
    return fixture;
  }

  function createBareHost(): ComponentFixture<BareAsyncHostComponent> {
    TestBed.configureTestingModule({ imports: [BareAsyncHostComponent] });
    const fixture = TestBed.createComponent(BareAsyncHostComponent);
    fixture.detectChanges();
    return fixture;
  }

  /** Which of the three branches is on screen, by the marker its template carries. */
  function branches(fixture: ComponentFixture<unknown>): string[] {
    return ['skeleton', 'error', 'loaded'].filter(
      (id) => host(fixture).querySelector(`[data-testid="${id}"]`) !== null
    );
  }

  function setState(fixture: ComponentFixture<AsyncHostComponent>, next: AsyncSnapshot<Row>): void {
    fixture.componentInstance.state.set(next);
    fixture.detectChanges();
  }

  it('renders the loading template while the read has neither value nor error', () => {
    const fixture = createHost();

    expect(branches(fixture)).toEqual(['skeleton']);
  });

  it('renders the host template with the value in scope once it loads', () => {
    const fixture = createHost();
    setState(fixture, LOADED);

    expect(branches(fixture)).toEqual(['loaded']);
    expect(requireEl(host(fixture), '[data-testid="title"]').textContent).toBe('First');
  });

  it('renders the error template and nothing else when the read fails', () => {
    const fixture = createHost();
    setState(fixture, { kind: 'error', error: new Error('boom') });

    expect(branches(fixture)).toEqual(['error']);
  });

  it('exposes the value under the directive name too, so `as` binds it', () => {
    const fixture = createBareHost();
    fixture.componentInstance.state.set({ kind: 'value', value: { id: 'a', title: 'Aliased' } });
    fixture.detectChanges();

    expect(requireEl(host(fixture), '[data-testid="loaded"]').textContent).toBe('Aliased');
  });

  it('renders nothing at all when no alternative template is supplied', () => {
    const fixture = createBareHost();

    expect(host(fixture).querySelector('[data-testid="loaded"]')).toBeNull();
  });

  it('keeps the loaded view alive across a new value, updating it in place', () => {
    const fixture = createHost();
    setState(fixture, LOADED);

    const before = requireEl<HTMLElement>(host(fixture), '[data-testid="loaded"]');
    requireEl<HTMLInputElement>(host(fixture), '[data-testid="draft"]').value = 'half-written';

    setState(fixture, { kind: 'value', value: { id: 'a', title: 'Second' } });

    // The same node, not an equal one: a directive that recreated the view on every value
    // would pass the text assertion below and still throw away what the user had typed.
    const after = requireEl<HTMLElement>(host(fixture), '[data-testid="loaded"]');
    expect(after).toBe(before);
    expect(requireEl<HTMLInputElement>(after, '[data-testid="draft"]').value).toBe('half-written');
    expect(requireEl(host(fixture), '[data-testid="title"]').textContent).toBe('Second');
    expect(leavesDestroyed).toBe(0);
  });

  it('replaces the loaded view when the branch has changed in between', () => {
    const fixture = createHost();
    setState(fixture, LOADED);
    const before = requireEl(host(fixture), '[data-testid="loaded"]');

    setState(fixture, { kind: 'loading' });
    setState(fixture, LOADED);

    expect(requireEl(host(fixture), '[data-testid="loaded"]')).not.toBe(before);
  });

  it('leaves the skeleton in place while the read stays loading', () => {
    const fixture = createHost();
    const before = requireEl(host(fixture), '[data-testid="skeleton"]');

    setState(fixture, { kind: 'loading' });

    expect(requireEl(host(fixture), '[data-testid="skeleton"]')).toBe(before);
  });

  it('destroys the loaded view when the branch changes, rather than detaching it', () => {
    const fixture = createHost();
    setState(fixture, LOADED);
    expect(leavesDestroyed).toBe(0);

    setState(fixture, { kind: 'error', error: new Error('boom') });

    // A component left alive under a cleared container keeps its subscriptions and its
    // effects; the branch assertions above cannot tell that apart from a real teardown.
    expect(leavesDestroyed).toBe(1);
  });

  it('has a context guard that asserts a type rather than checking one', () => {
    const directive = {} as AsyncDirective<Row>;

    // The signature is what Angular's template type-checker consumes; the body never runs
    // in production and could not validate anything if it did, because the directive
    // chooses the template from the snapshot before any context exists. Its value is the
    // build error it produces — `{{ row.titel }}` in the host above fails `pnpm build`,
    // and compiles to `undefined` on screen without this method present.
    expect(AsyncDirective.ngTemplateContextGuard(directive, undefined)).toBeTrue();
  });
});
