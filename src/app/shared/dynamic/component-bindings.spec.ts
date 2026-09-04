import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import type { ComponentRef, WritableSignal } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  ViewContainerRef,
  input,
  model,
  numberAttribute,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { host } from '@/testing';
import type { ComponentInputs, ComponentModels, ComponentOutputs } from './component-bindings';
import { createDynamicComponent, dynamicComponent } from './component-bindings';

@Component({
  selector: 'test-subject',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p data-testid="body">{{ label() }}:{{ size() }}:{{ open() }}</p>`,
})
class SubjectComponent {
  readonly label = input.required<string>();
  readonly size = input(1, { transform: numberAttribute });
  readonly open = model(false);
  readonly chose = output<string>();

  emit(value: string): void {
    this.chose.emit(value);
  }
}

@Component({
  selector: 'test-aliased',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p>{{ total() }}</p>`,
})
class AliasedComponent {
  readonly total = input(0, { alias: 'count' });
}

@Directive({ selector: '[testNotAComponent]', standalone: true })
class NotAComponentDirective {}

@Component({
  selector: 'test-anchor-host',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-container #anchor />`,
})
class AnchorHostComponent {
  readonly anchor = viewChild.required('anchor', { read: ViewContainerRef });
}

describe('component bindings', () => {
  let fixture: ComponentFixture<AnchorHostComponent>;
  let container: ViewContainerRef;

  beforeEach(() => {
    fixture = TestBed.createComponent(AnchorHostComponent);
    fixture.detectChanges();
    container = fixture.componentInstance.anchor();
  });

  describe('type mapping', () => {
    // These assertions are checked by the compiler, not at runtime: if `ComponentInputs`
    // stopped seeing `size`, or reported its read type instead of its transform's write
    // type, `pnpm typecheck` would fail on this file. The `expect` keeps the spec honest
    // about running.
    it('maps a transformed input to the type it accepts, not the type it reads', () => {
      const widened: ComponentInputs<SubjectComponent>['size'] = '4';
      const alsoAccepted: ComponentInputs<SubjectComponent>['size'] = 4;
      expect([widened, alsoAccepted]).toEqual(['4', 4]);
    });

    it('exposes a model as a two-way member and not as an output', () => {
      const modelValue: ComponentModels<SubjectComponent>['open'] = true;
      // `keyof ComponentOutputs` is exactly `'chose'`: `open` is an `OutputRef` too, but its
      // registered output is `openChange`, so listing it here would name an event that
      // never fires.
      const outputNames: (keyof ComponentOutputs<SubjectComponent>)[] = ['chose'];
      expect(modelValue).toBeTrue();
      expect(outputNames).toEqual(['chose']);
    });
  });

  describe('dynamicComponent', () => {
    it('rejects a type that is not a component', () => {
      expect(() => dynamicComponent(NotAComponentDirective, () => [])).toThrowError(
        /NotAComponentDirective is not a component/
      );
    });

    it('rejects an input bound under its class member name when it is aliased', () => {
      // The compiler cannot catch this: `total` *is* the member name, and the alias exists
      // only in the decorator metadata. `reflectComponentType` is what sees both.
      expect(() =>
        dynamicComponent(AliasedComponent, (bind) => [bind.input('total', () => 1)])
      ).toThrowError(/has no input "total".*"count"/);
    });

    it('accepts an aliased input under its alias', () => {
      const descriptor = dynamicComponent(AliasedComponent, (bind) => [
        // `count` is not a class member, so the typed name has to be widened here. That the
        // cast is needed at all is the point: an alias splits the name the compiler knows
        // from the name Angular binds.
        bind.input('count' as 'total', () => 7),
      ]);
      const ref = container.createComponent(descriptor.type, {
        bindings: [...descriptor.bindings],
      });
      fixture.detectChanges();
      expect((ref.location.nativeElement as HTMLElement).textContent).toContain('7');
    });

    it('rejects an output name the component does not declare', () => {
      expect(() =>
        // Same widening as above, standing in for a rename that the type system would
        // normally catch but a JavaScript caller would not.
        dynamicComponent(SubjectComponent, (bind) => [bind.output('picked' as 'chose', () => {})])
      ).toThrowError(/has no output "picked".*"chose"/);
    });

    it('carries the component type and its bindings without rendering anything', () => {
      const descriptor = dynamicComponent(SubjectComponent, (bind) => [
        bind.input('label', () => 'idle'),
      ]);
      expect(descriptor.type).toBe(SubjectComponent);
      expect(descriptor.bindings.length).toBe(1);
      expect(container.length).toBe(0);
    });
  });

  describe('createDynamicComponent', () => {
    let open: WritableSignal<boolean>;
    let chosen: string[];
    let ref: ComponentRef<SubjectComponent>;

    beforeEach(() => {
      open = signal(false);
      chosen = [];
      ref = createDynamicComponent(container, SubjectComponent, (bind) => [
        bind.input('label', () => 'Revenue'),
        bind.input('size', () => '3'),
        bind.model('open', open),
        bind.output('chose', (value) => chosen.push(value)),
      ]);
      fixture.detectChanges();
    });

    it('returns a ComponentRef typed as the component', () => {
      // Typed, so this reads a real member rather than going through `unknown`.
      expect(ref.instance.label()).toBe('Revenue');
    });

    it('applies the transform to the bound value', () => {
      expect(ref.instance.size()).toBe(3);
      expect(host(fixture).textContent).toContain('Revenue:3:false');
    });

    it('writes a model change back to the bound signal', () => {
      ref.instance.open.set(true);
      fixture.detectChanges();
      expect(open()).toBeTrue();
    });

    it('pushes a model change from the bound signal into the component', () => {
      open.set(true);
      fixture.detectChanges();
      expect(ref.instance.open()).toBeTrue();
      expect(host(fixture).textContent).toContain('Revenue:3:true');
    });

    it('routes an output to the bound listener', () => {
      ref.instance.emit('breakdown');
      expect(chosen).toEqual(['breakdown']);
    });

    it('inserts at the requested index', () => {
      createDynamicComponent(
        container,
        SubjectComponent,
        (bind) => [bind.input('label', () => 'First')],
        { index: 0 }
      );
      fixture.detectChanges();
      expect(host(fixture).textContent).toMatch(/First.*Revenue/s);
    });
  });
});
