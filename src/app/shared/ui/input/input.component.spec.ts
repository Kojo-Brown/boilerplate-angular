import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { zodValidator } from '@/app/core/validators/zod-validator';
import { host, itHonoursTheValueAccessorContract, requireEl } from '@/testing';
import { z } from 'zod';
import { InputComponent } from './input.component';

/**
 * Host state is held in signals, not plain fields. TestBed runs zoneless by default in
 * Angular 22, so `fixture.detectChanges()` only refreshes views that something marked
 * dirty — writing a signal does that, assigning to a field does not.
 */
@Component({
  standalone: true,
  imports: [InputComponent, ReactiveFormsModule],
  template: `
    <form [formGroup]="form">
      <app-input
        [label]="label()"
        [hint]="hint()"
        [placeholder]="placeholder()"
        [autocomplete]="autocomplete()"
        formControlName="email"
      />
    </form>
  `,
})
class HostComponent {
  readonly label = signal('Email');
  readonly hint = signal('');
  readonly placeholder = signal('Enter value');
  readonly autocomplete = signal('');
  readonly form = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, zodValidator(z.string().email('Enter a work address'))],
    }),
  });
}

describe('InputComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let component: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function input(): HTMLInputElement {
    return requireEl<HTMLInputElement>(host(fixture), 'input');
  }

  function alert(): HTMLElement | null {
    return host(fixture).querySelector<HTMLElement>('[role="alert"]');
  }

  it('renders the label, connected to the input', () => {
    const label = requireEl<HTMLLabelElement>(host(fixture), 'label');
    expect(label.textContent?.trim()).toBe('Email');
    expect(label.htmlFor).toBe(input().id);
  });

  it('renders no label element when there is no label', () => {
    component.label.set('');
    fixture.detectChanges();
    expect(host(fixture).querySelector('label')).toBeNull();
  });

  it('passes the placeholder and autocomplete through', () => {
    component.autocomplete.set('email');
    fixture.detectChanges();
    expect(input().placeholder).toBe('Enter value');
    expect(input().getAttribute('autocomplete')).toBe('email');
  });

  it('omits autocomplete rather than emitting an empty one', () => {
    expect(input().hasAttribute('autocomplete')).toBeFalse();
  });

  it('updates the form control as it is typed into', () => {
    input().value = 'ada@example.test';
    input().dispatchEvent(new Event('input'));
    expect(component.form.controls.email.value).toBe('ada@example.test');
  });

  /**
   * The component takes no `error` input any more. The message below is never handed to
   * it: it is the control's, resolved through `FIELD_ERROR_MESSAGES`.
   */
  it('reports the control’s error once the field has been left', () => {
    expect(alert()).toBeNull();

    input().dispatchEvent(new FocusEvent('blur'));
    fixture.detectChanges();

    expect(alert()?.textContent?.trim()).toBe('Email is required.');
  });

  it('prefers the schema’s message to the built-in one', () => {
    component.form.controls.email.setValue('not-an-address');
    component.form.controls.email.markAsTouched();
    fixture.detectChanges();

    expect(alert()?.textContent?.trim()).toBe('Enter a work address');
  });

  it('shows an error pushed in from outside the form, like a rejected sign-in', () => {
    component.form.controls.email.setValue('ada@example.test');
    component.form.controls.email.markAsTouched();
    component.form.controls.email.setErrors({ zod: 'That address is already registered.' });
    fixture.detectChanges();

    expect(alert()?.textContent?.trim()).toBe('That address is already registered.');
  });

  it('marks the input invalid for assistive technology exactly when it shows the message', () => {
    expect(input().getAttribute('aria-invalid')).toBeNull();

    component.form.controls.email.markAsTouched();
    fixture.detectChanges();

    expect(input().getAttribute('aria-invalid')).toBe('true');
  });

  /**
   * Both descriptions, in order. Dropping the hint while an error is showing would take
   * the format rule away exactly when it is being asked for.
   */
  it('describes the input by its hint and its error together', () => {
    component.hint.set('We only use this to sign you in.');
    fixture.detectChanges();
    const hintId = requireEl<HTMLElement>(host(fixture), 'p').id;
    expect(input().getAttribute('aria-describedby')).toBe(hintId);

    component.form.controls.email.markAsTouched();
    fixture.detectChanges();

    const described = input().getAttribute('aria-describedby')?.split(' ') ?? [];
    expect(described.length).toBe(2);
    expect(described[0]).toBe(hintId);
    expect(host(fixture).querySelector(`#${described[1]}`)).toBe(alert());
  });

  it('has no aria-describedby when there is nothing describing it', () => {
    expect(input().getAttribute('aria-describedby')).toBeNull();
  });
});

/**
 * The shared contract, in a `describe` of its own: each check builds its own fixture, so
 * it must not sit under a `beforeEach` that has already instantiated the TestBed.
 */
describe('InputComponent as a value accessor', () => {
  itHonoursTheValueAccessorContract<string>({
    create: async () => {
      await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
      const built = TestBed.createComponent(HostComponent);
      built.detectChanges();
      return {
        fixture: built,
        control: built.componentInstance.form.controls.email,
        element: requireEl<HTMLElement>(host(built), 'app-input'),
      };
    },
    written: 'grace@example.test',
    rendered: (harness) => requireEl<HTMLInputElement>(harness.element, 'input').value,
    edit: (harness) => {
      const field = requireEl<HTMLInputElement>(harness.element, 'input');
      field.value = 'ada@example.test';
      field.dispatchEvent(new Event('input'));
    },
    invalidates: (harness) => harness.control.setValue(''),
    errorMessage: /required/i,
  });
});
