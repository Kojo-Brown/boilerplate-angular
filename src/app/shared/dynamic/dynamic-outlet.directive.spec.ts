import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import type { WritableSignal } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { host } from '@/testing';
import type { DynamicComponent } from './component-bindings';
import { dynamicComponent } from './component-bindings';
import { DynamicOutletDirective } from './dynamic-outlet.directive';

let created = 0;
let destroyed = 0;

@Component({
  selector: 'test-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p data-testid="panel">{{ label() }}={{ count() }}{{ open() ? '+' : '-' }}</p>`,
})
class PanelComponent {
  readonly label = input.required<string>();
  readonly count = input(0);
  readonly open = model(false);
  readonly chose = output<string>();

  constructor() {
    created += 1;
  }

  ngOnDestroy(): void {
    destroyed += 1;
  }

  emit(value: string): void {
    this.chose.emit(value);
  }
}

@Component({
  selector: 'test-other-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p data-testid="other">other</p>`,
})
class OtherPanelComponent {}

@Component({
  selector: 'test-outlet-host',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DynamicOutletDirective],
  template: `<ng-container [appDynamicOutlet]="descriptor()" />`,
})
class OutletHostComponent {
  readonly descriptor = signal<DynamicComponent | null>(null);
  readonly outlet = viewChild.required(DynamicOutletDirective);
}

describe('DynamicOutletDirective', () => {
  let fixture: ComponentFixture<OutletHostComponent>;
  let component: OutletHostComponent;
  let count: WritableSignal<number>;
  let open: WritableSignal<boolean>;
  let chosen: string[];

  /** A descriptor whose bindings read the signals this spec owns. */
  const panelDescriptor = (label: string): DynamicComponent =>
    dynamicComponent(PanelComponent, (bind) => [
      bind.input('label', () => label),
      bind.input('count', count),
      bind.model('open', open),
      bind.output('chose', (value) => chosen.push(value)),
    ]);

  beforeEach(() => {
    created = 0;
    destroyed = 0;
    count = signal(1);
    open = signal(false);
    chosen = [];

    fixture = TestBed.createComponent(OutletHostComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders nothing until a descriptor arrives', () => {
    expect(host(fixture).querySelector('[data-testid="panel"]')).toBeNull();
    expect(component.outlet().componentRef).toBeNull();
    expect(created).toBe(0);
  });

  it('renders the described component with its bound inputs', () => {
    component.descriptor.set(panelDescriptor('Revenue'));
    fixture.detectChanges();

    expect(host(fixture).textContent).toContain('Revenue=1-');
    expect(component.outlet().componentRef).not.toBeNull();
    expect(created).toBe(1);
  });

  it('updates a bound input without recreating the component', () => {
    component.descriptor.set(panelDescriptor('Revenue'));
    fixture.detectChanges();
    const first = component.outlet().componentRef;

    count.set(42);
    fixture.detectChanges();

    expect(host(fixture).textContent).toContain('Revenue=42-');
    // The whole reason to bind rather than re-render: the instance survives, so whatever
    // state it holds — focus, scroll, an open disclosure — survives with it.
    expect(component.outlet().componentRef).toBe(first);
    expect(created).toBe(1);
    expect(destroyed).toBe(0);
  });

  it('recreates the component when the descriptor reference changes', () => {
    component.descriptor.set(panelDescriptor('Revenue'));
    fixture.detectChanges();
    const first = component.outlet().componentRef;

    component.descriptor.set(panelDescriptor('Signups'));
    fixture.detectChanges();

    expect(host(fixture).textContent).toContain('Signups=1-');
    expect(component.outlet().componentRef).not.toBe(first);
    expect(created).toBe(2);
    expect(destroyed).toBe(1);
  });

  it('swaps to a different component type', () => {
    component.descriptor.set(panelDescriptor('Revenue'));
    fixture.detectChanges();

    component.descriptor.set(dynamicComponent(OtherPanelComponent, () => []));
    fixture.detectChanges();

    expect(host(fixture).querySelector('[data-testid="panel"]')).toBeNull();
    expect(host(fixture).querySelector('[data-testid="other"]')).not.toBeNull();
    expect(destroyed).toBe(1);
  });

  it('destroys the component and clears the ref when the descriptor becomes null', () => {
    component.descriptor.set(panelDescriptor('Revenue'));
    fixture.detectChanges();

    component.descriptor.set(null);
    fixture.detectChanges();

    expect(host(fixture).querySelector('[data-testid="panel"]')).toBeNull();
    expect(component.outlet().componentRef).toBeNull();
    expect(destroyed).toBe(1);
  });

  it('routes outputs to the descriptor listener', () => {
    component.descriptor.set(panelDescriptor('Revenue'));
    fixture.detectChanges();

    const ref = component.outlet().componentRef;
    (ref?.instance as PanelComponent).emit('row-1');

    expect(chosen).toEqual(['row-1']);
  });

  it('carries a model change in both directions', () => {
    component.descriptor.set(panelDescriptor('Revenue'));
    fixture.detectChanges();
    const panel = component.outlet()?.componentRef?.instance as PanelComponent;

    panel.open.set(true);
    fixture.detectChanges();
    expect(open()).toBeTrue();
    expect(host(fixture).textContent).toContain('Revenue=1+');

    open.set(false);
    fixture.detectChanges();
    expect(panel.open()).toBeFalse();
    expect(host(fixture).textContent).toContain('Revenue=1-');
  });

  it('destroys the rendered component when the host view is destroyed', () => {
    component.descriptor.set(panelDescriptor('Revenue'));
    fixture.detectChanges();

    fixture.destroy();

    expect(destroyed).toBe(1);
  });
});
