import {
  ChangeDetectionStrategy,
  Component,
  forwardRef,
  inject,
  Injector,
  signal,
} from '@angular/core';
import type { OnInit } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import {
  FormControl,
  FormGroup,
  NG_VALIDATORS,
  NG_VALUE_ACCESSOR,
  NgControl,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import type {
  AbstractControl,
  ControlValueAccessor,
  ValidationErrors,
  Validator,
} from '@angular/forms';
import { FIELD_ERROR_MESSAGES } from './error-messages';
import { hostControl } from './host-control';

/** A value accessor that does both halves: provides both tokens, renders its own errors. */
@Component({
  selector: 'probe-field',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => ProbeFieldComponent), multi: true },
    { provide: NG_VALIDATORS, useExisting: forwardRef(() => ProbeFieldComponent), multi: true },
  ],
  template: `
    <input [value]="value()" (input)="onInput($event)" (blur)="onTouched()" />
    @if (field.errorMessage(); as message) {
      <p role="alert">{{ message }}</p>
    }
  `,
})
class ProbeFieldComponent implements ControlValueAccessor, Validator {
  readonly field = hostControl({
    label: () => 'Nickname',
    messages: { probeTooShort: () => 'Two characters at least.' },
  });
  readonly value = signal('');

  writeValue(value: string | null): void {
    this.field.connect();
    this.value.set(value ?? '');
  }
  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  validate(control: AbstractControl): ValidationErrors | null {
    return String(control.value ?? '').length === 1 ? { probeTooShort: true } : null;
  }
  onTouched: () => void = () => {};
  private onChange: (value: string) => void = () => {};
  onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.value.set(value);
    this.onChange(value);
  }
}

/**
 * The same thing written the way everyone writes it first: resolve `NgControl` in
 * `ngOnInit` and keep the control it was holding at the time.
 */
@Component({
  selector: 'probe-on-init',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => ProbeOnInitComponent),
      multi: true,
    },
  ],
  template: `<input />`,
})
class ProbeOnInitComponent implements ControlValueAccessor, OnInit {
  private readonly injector = inject(Injector);
  directiveAtInit: NgControl | null = null;
  controlAtInit: AbstractControl | null = null;

  ngOnInit(): void {
    this.directiveAtInit = this.injector.get(NgControl, null, { self: true, optional: true });
    this.controlAtInit = this.directiveAtInit?.control ?? null;
  }
  writeValue(): void {}
  registerOnChange(): void {}
  registerOnTouched(): void {}
}

/** A `hostControl` user rendered *inside* another accessor's template. */
@Component({
  selector: 'probe-nested',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span>{{ field.control() === null ? 'unbound' : 'bound' }}</span>`,
})
class ProbeNestedComponent {
  readonly field = hostControl();
  connect(): void {
    this.field.connect();
  }
}

@Component({
  selector: 'probe-outer',
  standalone: true,
  imports: [ProbeNestedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => ProbeOuterComponent), multi: true },
  ],
  template: `<probe-nested />`,
})
class ProbeOuterComponent implements ControlValueAccessor {
  writeValue(): void {}
  registerOnChange(): void {}
  registerOnTouched(): void {}
}

@Component({
  standalone: true,
  imports: [ProbeFieldComponent, ProbeOnInitComponent, ProbeOuterComponent, ReactiveFormsModule],
  template: `
    <form [formGroup]="form">
      <probe-field formControlName="named" />
      <probe-on-init formControlName="named" />
      <probe-outer formControlName="named" />
    </form>
  `,
})
class NamedHostComponent {
  readonly form = new FormGroup({
    named: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });
}

@Component({
  standalone: true,
  imports: [ProbeFieldComponent, ReactiveFormsModule],
  template: `<probe-field [formControl]="control" />`,
})
class DirectHostComponent {
  readonly control = new FormControl('', { nonNullable: true });
}

/** The same component with no form directive on it at all, bound to nothing. */
@Component({
  standalone: true,
  imports: [ProbeFieldComponent],
  template: `<probe-field />`,
})
class UnboundHostComponent {}

function probeIn<T>(fixture: ComponentFixture<T>): ProbeFieldComponent {
  return fixture.debugElement.query((node) => node.componentInstance instanceof ProbeFieldComponent)
    .componentInstance as ProbeFieldComponent;
}

describe('hostControl', () => {
  function buildNamed() {
    const fixture = TestBed.createComponent(NamedHostComponent);
    fixture.detectChanges();
    return {
      fixture,
      field: probeIn(fixture),
      control: fixture.componentInstance.form.controls.named,
    };
  }

  it('binds to the control under formControlName', () => {
    const { field, control } = buildNamed();
    expect(field.field.control()).toBe(control);
  });

  it('binds to the control under [formControl]', () => {
    const fixture = TestBed.createComponent(DirectHostComponent);
    fixture.detectChanges();
    expect(probeIn(fixture).field.control()).toBe(fixture.componentInstance.control);
  });

  it('stays unbound, rather than throwing, with no form directive at all', () => {
    const fixture = TestBed.createComponent(UnboundHostComponent);
    fixture.detectChanges();
    const field = probeIn(fixture);

    expect(field.field.control()).toBeNull();
    expect(field.field.state()).toBeNull();
    expect(field.field.errorMessage()).toBeNull();
  });

  /**
   * The finding `connect()` exists for. `FormControlName` looks its control up out of the
   * parent `FormGroupDirective` in its own `ngOnChanges`, which runs after the hooks of
   * the component sharing its element — so the obvious implementation reads `null` here
   * and renders no validation state, in exactly the binding syntax most forms use.
   */
  it('is why ngOnInit is too early: the directive is there, its control is not', () => {
    const { fixture } = buildNamed();
    const probe = fixture.debugElement.query(
      (node) => node.componentInstance instanceof ProbeOnInitComponent
    ).componentInstance as ProbeOnInitComponent;

    expect(probe.directiveAtInit).not.toBeNull();
    expect(probe.controlAtInit).toBeNull();
  });

  /**
   * `self: true` in the lookup. The element injector chain reaches the ancestor element's
   * directives, so a field rendered inside another accessor's template would otherwise
   * bind to that accessor's control and report its errors as its own.
   */
  it('does not bind to an ancestor accessor\u2019s control', () => {
    const { fixture } = buildNamed();
    const nested = fixture.debugElement.query(
      (node) => node.componentInstance instanceof ProbeNestedComponent
    ).componentInstance as ProbeNestedComponent;

    nested.connect();
    expect(nested.field.control()).toBeNull();
  });

  it('tracks the control\u2019s state as it changes', () => {
    const { fixture, field, control } = buildNamed();
    expect(field.field.state()?.valid).toBeFalse();

    control.setValue('ada');
    fixture.detectChanges();

    expect(field.field.state()?.valid).toBeTrue();
    expect(field.field.state()?.value).toBe('ada');
  });

  it('withholds the message until the control has been touched', () => {
    const { fixture, field, control } = buildNamed();
    expect(field.field.showsError()).toBeFalse();
    expect(field.field.errorMessage()).toBeNull();

    control.markAsTouched();
    fixture.detectChanges();

    expect(field.field.showsError()).toBeTrue();
    expect(field.field.errorMessage()).toBe('Nickname is required.');
  });

  it('layers the component\u2019s own messages over the application\u2019s', () => {
    const { fixture, field, control } = buildNamed();
    control.setValue('a');
    control.markAsTouched();
    fixture.detectChanges();

    // `probeTooShort` comes from the component's validator and its own message map;
    // `required` would have come from the injected one, and does not apply to 'a'.
    expect(field.field.errorMessage()).toBe('Two characters at least.');
  });

  it('reports an error set from outside the form, like a server response', () => {
    const { fixture, field, control } = buildNamed();
    control.setValue('ada');
    control.markAsTouched();
    control.setErrors({ zod: 'That nickname is taken.' });
    fixture.detectChanges();

    expect(field.field.errorMessage()).toBe('That nickname is taken.');
  });
});

describe('hostControl with FIELD_ERROR_MESSAGES replaced', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: FIELD_ERROR_MESSAGES,
          useValue: { required: () => 'Il faut remplir ce champ.' },
        },
      ],
    });
  });

  it('takes the application\u2019s map from the injector', () => {
    const fixture = TestBed.createComponent(NamedHostComponent);
    fixture.detectChanges();
    const field = probeIn(fixture);

    fixture.componentInstance.form.controls.named.markAsTouched();
    fixture.detectChanges();

    expect(field.field.errorMessage()).toBe('Il faut remplir ce champ.');
  });
});
