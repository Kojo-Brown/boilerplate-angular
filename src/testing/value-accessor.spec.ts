import {
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  input,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, NG_VALUE_ACCESSOR, ReactiveFormsModule, Validators } from '@angular/forms';
import type { ControlValueAccessor } from '@angular/forms';
import { hostControl } from '@/app/core/forms';
import { host, requireEl } from './dom';
import { VALUE_ACCESSOR_CHECKS } from './value-accessor';
import type { ValueAccessorContract } from './value-accessor';

/**
 * Flags for the ways the accessor below is allowed to be wrong.
 *
 * One component with switches rather than six near-identical ones: what each check
 * catches is then visible as the single flag that turns it red.
 */
interface Faults {
  /** Reports the value back from `writeValue`, the classic two-way loop. */
  readonly echoesWrites?: boolean;
  /** Has no `setDisabledState`, so `form.disable()` leaves the input live. */
  readonly ignoresDisabled?: boolean;
  /** Marks the control touched on the first keystroke. */
  readonly touchesOnEdit?: boolean;
  /** Never calls the `registerOnTouched` callback. */
  readonly deafToBlur?: boolean;
  /** Renders no error, the state of every accessor that takes an `error` input. */
  readonly hidesErrors?: boolean;
  /** Never puts the value it is given on screen. */
  readonly dropsWrites?: boolean;
  /** Reports into a field nobody has reached yet. */
  readonly errorsBeforeTouched?: boolean;
}

@Component({
  selector: 'probe-accessor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => ProbeAccessorComponent),
      multi: true,
    },
  ],
  template: `
    <input [value]="value()" [disabled]="isDisabled()" (input)="onInput($event)" (blur)="leave()" />
    @if (message(); as text) {
      <p role="alert">{{ text }}</p>
    }
  `,
})
class ProbeAccessorComponent implements ControlValueAccessor {
  readonly faults = input<Faults>({});

  readonly field = hostControl({ label: () => 'Nickname' });
  readonly value = signal('');
  readonly isDisabled = signal(false);

  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  readonly message = computed(() => {
    if (this.faults().hidesErrors) return null;
    if (this.faults().errorsBeforeTouched) {
      return this.field.state()?.invalid === true ? 'Nickname is required.' : null;
    }
    return this.field.errorMessage();
  });

  writeValue(value: string | null): void {
    this.field.connect();
    if (!this.faults().dropsWrites) this.value.set(value ?? '');
    if (this.faults().echoesWrites) this.onChange(value ?? '');
  }
  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    if (this.faults().ignoresDisabled) return;
    this.isDisabled.set(isDisabled);
  }
  leave(): void {
    if (this.faults().deafToBlur) return;
    this.onTouched();
  }
  onInput(event: Event): void {
    const next = (event.target as HTMLInputElement).value;
    this.value.set(next);
    this.onChange(next);
    if (this.faults().touchesOnEdit) this.onTouched();
  }
}

@Component({
  standalone: true,
  imports: [ProbeAccessorComponent, ReactiveFormsModule],
  template: `<probe-accessor [faults]="faults" [formControl]="control" />`,
})
class ProbeHostComponent {
  faults: Faults = {};
  readonly control = new FormControl('', { nonNullable: true, validators: [Validators.required] });
}

function contractFor(faults: Faults): ValueAccessorContract<string> {
  return {
    create: async () => {
      // This file runs several checks inside one spec, and a check builds a fixture.
      // `itHonoursTheValueAccessorContract` gives each check its own spec, so the usual
      // per-spec reset covers it; here it has to be asked for.
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({ imports: [ProbeHostComponent] }).compileComponents();
      const fixture = TestBed.createComponent(ProbeHostComponent);
      fixture.componentInstance.faults = faults;
      fixture.detectChanges();
      return {
        fixture,
        control: fixture.componentInstance.control,
        element: requireEl<HTMLElement>(host(fixture), 'probe-accessor'),
      };
    },
    written: 'grace',
    rendered: (harness) => requireEl<HTMLInputElement>(harness.element, 'input').value,
    edit: (harness) => {
      const input = requireEl<HTMLInputElement>(harness.element, 'input');
      input.value = 'ada';
      input.dispatchEvent(new Event('input'));
    },
    invalidates: (harness) => harness.control.setValue(''),
    errorMessage: /required/i,
  };
}

/** Run one check by name, and report whether it threw and what it said. */
async function runCheck(name: string, faults: Faults): Promise<string | null> {
  const check = VALUE_ACCESSOR_CHECKS.find((candidate) => candidate.name === name);
  if (check === undefined) throw new Error(`No value-accessor check is named "${name}".`);

  try {
    await check.run(contractFor(faults) as unknown as ValueAccessorContract<never>);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

/**
 * The suite's own tests.
 *
 * A conformance suite that has stopped conforming to anything passes silently and reads
 * exactly like one that works, so each check is pointed at an accessor built to break it —
 * and at one that does not, so a check cannot pass by simply always throwing.
 */
describe('the value-accessor contract', () => {
  it('passes a correctly written accessor', async () => {
    for (const check of VALUE_ACCESSOR_CHECKS) {
      if (!check.applies(contractFor({}) as unknown as ValueAccessorContract<never>)) continue;
      expect(await runCheck(check.name, {}))
        .withContext(check.name)
        .toBeNull();
    }
  });

  it('catches an accessor that reports its own writes back', async () => {
    expect(
      await runCheck('writes a value in without reporting it back', { echoesWrites: true })
    ).toMatch(/emitted 2 times|dirty after a programmatic write/);
  });

  it('catches an accessor with no setDisabledState', async () => {
    expect(
      await runCheck("reflects the control's disabled state into the DOM", {
        ignoresDisabled: true,
      })
    ).toMatch(/left 1 of 1 element\(s\) editable/);
  });

  it('catches an accessor that marks the control touched as it is typed into', async () => {
    expect(
      await runCheck('does not mark the control touched merely by being edited', {
        touchesOnEdit: true,
      })
    ).toMatch(/touched after an edit but before focus left/);
  });

  it('catches an accessor that never reports being left', async () => {
    expect(
      await runCheck('marks the control touched when focus leaves it', { deafToBlur: true })
    ).toMatch(/still untouched/);
  });

  it('catches an accessor that renders none of its control’s errors', async () => {
    expect(
      await runCheck("renders its control's error once the field has been left", {
        hidesErrors: true,
      })
    ).toMatch(/renders no error/);
  });

  it('catches an accessor that never shows what it was given', async () => {
    expect(
      await runCheck('writes a value in without reporting it back', { dropsWrites: true })
    ).toMatch(/writeValue did not reach the DOM/);
  });

  it('catches an accessor that reports into a field nobody has reached yet', async () => {
    expect(
      await runCheck("renders its control's error once the field has been left", {
        errorsBeforeTouched: true,
      })
    ).toMatch(/before the field has been touched/);
  });

  it('catches a reset that the accessor reports back', async () => {
    expect(await runCheck('renders what a reset leaves behind', { echoesWrites: true })).toMatch(
      /still dirty or touched after `reset\(\)`/
    );
  });

  it('skips the internal-focus check for an accessor with nothing to move focus between', () => {
    const check = VALUE_ACCESSOR_CHECKS.find(
      (candidate) =>
        candidate.name === 'does not mark the control touched while focus moves inside it'
    );
    expect(check?.applies(contractFor({}) as unknown as ValueAccessorContract<never>)).toBeFalse();
  });

  it('refuses a contract whose edit changes nothing, rather than passing it', async () => {
    const contract: ValueAccessorContract<string> = {
      ...contractFor({}),
      edit: () => {},
    };
    const check = VALUE_ACCESSOR_CHECKS.find(
      (candidate) => candidate.name === 'reports an edit, and marks the control dirty'
    );

    await expectAsync(
      check?.run(contract as unknown as ValueAccessorContract<never>) ?? Promise.resolve()
    ).toBeRejectedWithError(/left the control’s value at|left the control's value at/);
  });
});
