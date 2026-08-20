import {
  ChangeDetectionStrategy,
  Component,
  EnvironmentInjector,
  Injector,
  createEnvironmentInjector,
  effect,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import type { AbstractControl, ValidationErrors } from '@angular/forms';
import { host, requireEl } from '@/testing';
import { controlErrorSignal, controlSignal } from './control-signal';

/** Mirrors `zodValidator`'s shape: one message under a `zod` key. */
function messageValidator(message: string) {
  return (control: AbstractControl): ValidationErrors | null =>
    control.value === 'ok' ? null : { zod: message };
}

describe('controlSignal', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  function track<T>(control: AbstractControl<T>) {
    return TestBed.runInInjectionContext(() => controlSignal(control));
  }

  it('reports the control state before anything has been emitted', () => {
    const control = new FormControl('start', { nonNullable: true });

    const state = track(control);

    expect(state().value).toBe('start');
    expect(state().status).toBe('VALID');
    expect(state().touched).toBeFalse();
    expect(state().dirty).toBeFalse();
    expect(state().errors).toBeNull();
  });

  it('follows value changes', () => {
    const control = new FormControl('a', { nonNullable: true });
    const state = track(control);

    control.setValue('b');

    expect(state().value).toBe('b');
    expect(state().dirty).toBeFalse();
  });

  it('follows validity and errors', () => {
    const control = new FormControl('', {
      nonNullable: true,
      validators: [messageValidator('required')],
    });
    const state = track(control);

    expect(state().invalid).toBeTrue();
    expect(state().errors).toEqual({ zod: 'required' });

    control.setValue('ok');

    expect(state().valid).toBeTrue();
    expect(state().errors).toBeNull();
  });

  // The whole reason this exists: `touched` is the flag the error messages hang off,
  // it changes without any value change, and nothing outside `events` reports it.
  it('follows the touched flag', () => {
    const control = new FormControl('', { nonNullable: true });
    const state = track(control);

    control.markAsTouched();

    expect(state().touched).toBeTrue();
  });

  it('follows the dirty flag and the disabled state', () => {
    const control = new FormControl('', { nonNullable: true });
    const state = track(control);

    control.markAsDirty();
    expect(state().dirty).toBeTrue();

    control.disable();
    expect(state().disabled).toBeTrue();
    expect(state().status).toBe('DISABLED');
  });

  it('tracks a group, including cross-field errors set on the group itself', () => {
    const group = new FormGroup(
      {
        password: new FormControl('a', { nonNullable: true }),
        confirmPassword: new FormControl('b', { nonNullable: true }),
      },
      {
        validators: (control): ValidationErrors | null =>
          (control as FormGroup).controls['password'].value ===
          (control as FormGroup).controls['confirmPassword'].value
            ? null
            : { confirmPassword: "Passwords don't match" },
      }
    );
    const state = track(group);

    expect(state().errors).toEqual({ confirmPassword: "Passwords don't match" });

    group.controls.confirmPassword.setValue('a');

    expect(state().errors).toBeNull();
    expect(state().value).toEqual({ password: 'a', confirmPassword: 'a' });
  });

  it('does not invalidate downstream computeds when nothing a template reads changed', () => {
    const control = new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    });
    const state = track(control);

    let recomputes = 0;
    TestBed.runInInjectionContext(() => {
      effect(() => {
        state();
        recomputes++;
      });
    });
    TestBed.tick();
    expect(recomputes).toBe(1);

    // Revalidating produces a fresh `ValidationErrors` object with identical contents.
    // Compared by identity that would look like a change and re-run every consumer.
    control.updateValueAndValidity();
    TestBed.tick();

    expect(recomputes).toBe(1);
  });

  it('stops following the control once its injector is destroyed', () => {
    const control = new FormControl('a', { nonNullable: true });
    const child = createEnvironmentInjector([], TestBed.inject(EnvironmentInjector));
    const state = controlSignal(control, { injector: child });
    expect(state().value).toBe('a');

    child.destroy();
    control.setValue('b');

    // `toSignal` unsubscribes with its injector, so nothing invalidates the memo and the
    // snapshot is frozen at the last state it saw. Nothing keeps the control — or the
    // component behind it — alive either.
    expect(state().value).toBe('a');
  });

  it('refreshes an OnPush view when the control is mutated outside a bound listener', async () => {
    @Component({
      selector: 'app-control-signal-host',
      standalone: true,
      changeDetection: ChangeDetectionStrategy.OnPush,
      imports: [ReactiveFormsModule],
      template: `
        <input [formControl]="control" />
        @if (error()) {
          <p data-testid="error">{{ error() }}</p>
        }
      `,
    })
    class HostComponent {
      readonly control = new FormControl('', {
        nonNullable: true,
        validators: [messageValidator('Email is required')],
      });
      readonly error = controlErrorSignal(this.control, 'zod');
    }

    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    expect(host(fixture).querySelector('[data-testid="error"]')).toBeNull();

    // No click, no input, no blur — the kind of mutation a resolver, an async validator
    // or a server-side error report makes. Under zoneless this is exactly the write
    // that a template getter would render one refresh late, or not at all.
    fixture.componentInstance.control.markAsTouched();
    await fixture.whenStable();

    expect(requireEl(host(fixture), '[data-testid="error"]').textContent).toContain(
      'Email is required'
    );
  });
});

describe('controlErrorSignal', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  function track(control: AbstractControl, key = 'zod', showUntouched = false) {
    return TestBed.runInInjectionContext(() => controlErrorSignal(control, key, { showUntouched }));
  }

  it('stays quiet until the control is touched', () => {
    const control = new FormControl('', {
      nonNullable: true,
      validators: [messageValidator('Email is required')],
    });
    const error = track(control);

    expect(error()).toBeNull();

    control.markAsTouched();

    expect(error()).toBe('Email is required');
  });

  it('reports immediately with showUntouched', () => {
    const control = new FormControl('', {
      nonNullable: true,
      validators: [messageValidator('Email is required')],
    });

    expect(track(control, 'zod', true)()).toBe('Email is required');
  });

  it('clears once the control becomes valid', () => {
    const control = new FormControl('', {
      nonNullable: true,
      validators: [messageValidator('Email is required')],
    });
    const error = track(control);
    control.markAsTouched();

    control.setValue('ok');

    expect(error()).toBeNull();
  });

  it('ignores an unrelated error key', () => {
    const control = new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    });
    const error = track(control);
    control.markAsTouched();

    // `Validators.required` reports `{ required: true }`, not a message under `zod`.
    expect(error()).toBeNull();
  });

  it('ignores a non-string value under the error key rather than rendering an object', () => {
    const control = new FormControl('', {
      nonNullable: true,
      validators: [(): ValidationErrors => ({ zod: { message: 'nested' } })],
    });
    const error = track(control);
    control.markAsTouched();

    expect(error()).toBeNull();
  });

  it('can be created outside an injection context with an explicit injector', () => {
    const control = new FormControl('', {
      nonNullable: true,
      validators: [messageValidator('Email is required')],
    });
    const injector = TestBed.inject(Injector);

    // No `runInInjectionContext` — this is the lifecycle-hook / event-handler case.
    const error = controlErrorSignal(control, 'zod', { injector, showUntouched: true });

    expect(error()).toBe('Email is required');
  });
});

describe('controlSignal outside an injection context', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('throws without an injector', () => {
    const control = new FormControl('', { nonNullable: true });

    expect(() => controlSignal(control)).toThrowError(/inject/i);
  });
});
