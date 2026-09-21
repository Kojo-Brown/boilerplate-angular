import type { ComponentFixture } from '@angular/core/testing';
import type { FormControl } from '@angular/forms';
import { host } from './dom';

/**
 * The fixture a contract check is handed: a component that provides `NG_VALUE_ACCESSOR`,
 * bound to `control` by a form directive.
 */
export interface ValueAccessorHarness<TValue> {
  readonly fixture: ComponentFixture<unknown>;
  /** The control the accessor is bound to. Non-nullable, so `reset()` has a value to go to. */
  readonly control: FormControl<TValue>;
  /** The accessor's own root element, which is also the focus boundary. */
  readonly element: HTMLElement;
}

/** What a value accessor has to tell this suite about itself for the checks to run. */
export interface ValueAccessorContract<TValue> {
  /** Builds a fresh fixture. Called once per check, so no check can be affected by another. */
  readonly create: () => Promise<ValueAccessorHarness<TValue>>;
  /** A value to write in from outside, different from the control's initial one. */
  readonly written: TValue;
  /**
   * The value as the rendered DOM shows it — the chips a tag editor has, the `value` of a
   * text box. This is what makes "writeValue arrived" an assertion rather than a claim.
   */
  readonly rendered: (harness: ValueAccessorHarness<TValue>) => TValue;
  /** Makes the edit a person would make. Must produce a value different from the current one. */
  readonly edit: (harness: ValueAccessorHarness<TValue>) => void | Promise<void>;
  /**
   * Moves focus out of the accessor. The default fires `blur` *and* `focusout` on the last
   * focusable element, because a single-element accessor listens for the first and a
   * composite one can only hear the second.
   */
  readonly leave?: (harness: ValueAccessorHarness<TValue>) => void;
  /**
   * Moves focus between two elements *inside* the accessor. Only composite accessors have
   * one, and the check that uses it is skipped without it.
   */
  readonly internalFocusMove?: (harness: ValueAccessorHarness<TValue>) => void;
  /** Puts the control into a state its validators reject. Pairs with {@link errorMessage}. */
  readonly invalidates?: (harness: ValueAccessorHarness<TValue>) => void;
  /** What the rendered error should say once the control is invalid and touched. */
  readonly errorMessage?: RegExp;
}

/** One property of the `ControlValueAccessor` contract, as a runnable check. */
export interface ValueAccessorCheck {
  readonly name: string;
  /** Whether the contract supplies what this check needs. */
  readonly applies: (contract: ValueAccessorContract<never>) => boolean;
  readonly run: (contract: ValueAccessorContract<never>) => Promise<void>;
}

/**
 * Structural equality, by serialisation.
 *
 * Enough for what a form control holds — strings, numbers, arrays of them, plain objects
 * — and deliberately not a general deep-equal: a value accessor whose value is a `Map` or
 * a class instance is outside what this suite can compare, and would fail loudly here
 * rather than passing quietly.
 */
function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function describeValue(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}

/** Everything inside the accessor a person could put focus on. */
function focusables(harness: ValueAccessorHarness<never>): HTMLElement[] {
  return Array.from(
    harness.element.querySelectorAll<HTMLElement>('input, button, select, textarea')
  );
}

/** The elements whose `disabled` a control's disabled state has to reach. */
function disableables(
  harness: ValueAccessorHarness<never>
): (HTMLElement & { disabled: boolean })[] {
  return Array.from(
    harness.element.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
      'input, button, select, textarea'
    )
  );
}

function leave<TValue>(
  contract: ValueAccessorContract<TValue>,
  harness: ValueAccessorHarness<TValue>
): void {
  if (contract.leave !== undefined) {
    contract.leave(harness);
    return;
  }

  const elements = focusables(harness as ValueAccessorHarness<never>);
  const last = elements[elements.length - 1];
  if (last === undefined) {
    throw new Error(
      'The accessor renders nothing focusable, so the default `leave` has nothing to blur. ' +
        'Supply `leave` on the contract.'
    );
  }

  // `blur` does not bubble and `focusout` does; an accessor listens for one or the other,
  // never both, and this suite does not get to know which.
  last.dispatchEvent(new FocusEvent('blur', { relatedTarget: null }));
  last.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
}

/**
 * The `ControlValueAccessor` contract, as checks that throw.
 *
 * Every one of these is a rule Angular documents and enforces nowhere: an accessor that
 * breaks any of them compiles, renders, and behaves correctly in the demo the author
 * tried. The failure shows up later as a form that is dirty before anyone touched it, a
 * field that stays editable under `form.disable()`, or an error message that appears
 * while someone is still typing.
 *
 * They throw rather than calling `expect`, so that {@link file://./value-accessor.spec.ts}
 * can point each one at a deliberately broken accessor and assert it *fails*. A check that
 * has quietly stopped checking anything is worth less than no check at all.
 */
export const VALUE_ACCESSOR_CHECKS: readonly ValueAccessorCheck[] = [
  {
    name: 'writes a value in without reporting it back',
    applies: () => true,
    run: async (contract) => {
      const harness = await contract.create();
      const emissions: unknown[] = [];
      const subscription = harness.control.valueChanges.subscribe((value) => emissions.push(value));

      harness.control.setValue(contract.written);
      harness.fixture.detectChanges();
      subscription.unsubscribe();

      const shown = contract.rendered(harness);
      if (!sameValue(shown, contract.written)) {
        throw new Error(
          `writeValue did not reach the DOM: wrote ${describeValue(contract.written)}, ` +
            `the accessor renders ${describeValue(shown)}.`
        );
      }
      if (emissions.length !== 1) {
        throw new Error(
          `Setting the control's value emitted ${emissions.length} times, expected 1. An ` +
            'accessor that calls its `onChange` callback from `writeValue` echoes every ' +
            'programmatic write back into the control, and two-way bindings then ping-pong.'
        );
      }
      if (harness.control.dirty) {
        throw new Error(
          'The control is dirty after a programmatic write. `writeValue` must not report ' +
            'the value back — `dirty` means *the user* changed it, and a form that is dirty ' +
            'on load defeats every unsaved-changes guard built on it.'
        );
      }
      if (harness.control.touched) {
        throw new Error(
          'The control is touched after a programmatic write. Only leaving the field does that.'
        );
      }
    },
  },
  {
    name: 'reports an edit, and marks the control dirty',
    applies: () => true,
    run: async (contract) => {
      const harness = await contract.create();
      const before = harness.control.value;

      await contract.edit(harness);
      harness.fixture.detectChanges();

      if (sameValue(harness.control.value, before)) {
        throw new Error(
          `The contract's \`edit\` left the control's value at ${describeValue(before)}. ` +
            'Either the accessor did not report the change, or `edit` did not make one.'
        );
      }
      const shown = contract.rendered(harness);
      if (!sameValue(shown, harness.control.value)) {
        throw new Error(
          `After an edit the control holds ${describeValue(harness.control.value)} while the ` +
            `accessor renders ${describeValue(shown)}. The two have diverged.`
        );
      }
      if (!harness.control.dirty) {
        throw new Error(
          'The control is still pristine after a user edit. `registerOnChange`’s callback ' +
            'is what marks it dirty, so this accessor is updating the value some other way.'
        );
      }
    },
  },
  {
    name: 'does not mark the control touched merely by being edited',
    applies: () => true,
    run: async (contract) => {
      const harness = await contract.create();

      await contract.edit(harness);
      harness.fixture.detectChanges();

      if (harness.control.touched) {
        throw new Error(
          'The control is touched after an edit but before focus left the field. Every ' +
            '"show the error once they have been here" rule is built on `touched`, and this ' +
            'makes the message appear on the first keystroke.'
        );
      }
    },
  },
  {
    name: 'marks the control touched when focus leaves it',
    applies: () => true,
    run: async (contract) => {
      const harness = await contract.create();

      leave(contract, harness);
      harness.fixture.detectChanges();

      if (!harness.control.touched) {
        throw new Error(
          'Focus left the accessor and the control is still untouched, so the callback from ' +
            '`registerOnTouched` is never being called. Nothing else in a form can detect ' +
            'that a field was visited.'
        );
      }
    },
  },
  {
    name: 'does not mark the control touched while focus moves inside it',
    applies: (contract) => contract.internalFocusMove !== undefined,
    run: async (contract) => {
      const harness = await contract.create();
      contract.internalFocusMove?.(harness);
      harness.fixture.detectChanges();

      if (harness.control.touched) {
        throw new Error(
          'Moving focus between the accessor’s own controls marked the control touched. ' +
            'A composite accessor has to compare `focusout`’s `relatedTarget` against its ' +
            'own subtree, or tabbing from its text box to its own button counts as leaving.'
        );
      }
    },
  },
  {
    name: "reflects the control's disabled state into the DOM",
    applies: () => true,
    run: async (contract) => {
      const harness = await contract.create();

      harness.control.disable();
      harness.fixture.detectChanges();

      const elements = disableables(harness as ValueAccessorHarness<never>);
      if (elements.length === 0) {
        throw new Error('The accessor renders no form elements, so this check proves nothing.');
      }
      const stillEnabled = elements.filter((element) => !element.disabled);
      if (stillEnabled.length > 0) {
        throw new Error(
          `\`control.disable()\` left ${stillEnabled.length} of ${elements.length} element(s) ` +
            'editable. `setDisabledState` is optional on the interface and unimplemented by ' +
            'default, so a disabled control with a live input reports valid, submits, and ' +
            'never says a word.'
        );
      }

      harness.control.enable();
      harness.fixture.detectChanges();

      const stillDisabled = disableables(harness as ValueAccessorHarness<never>).filter(
        (element) => element.disabled
      );
      if (stillDisabled.length > 0) {
        throw new Error(
          `\`control.enable()\` left ${stillDisabled.length} element(s) disabled. ` +
            '`setDisabledState` has to handle both directions.'
        );
      }
    },
  },
  {
    name: 'renders what a reset leaves behind',
    applies: () => true,
    run: async (contract) => {
      const harness = await contract.create();

      await contract.edit(harness);
      harness.fixture.detectChanges();
      harness.control.reset();
      harness.fixture.detectChanges();

      const shown = contract.rendered(harness);
      if (!sameValue(shown, harness.control.value)) {
        throw new Error(
          `After \`reset()\` the control holds ${describeValue(harness.control.value)} and the ` +
            `accessor still renders ${describeValue(shown)}. A reset goes through \`writeValue\` ` +
            'like any other write.'
        );
      }
      if (harness.control.dirty || harness.control.touched) {
        throw new Error(
          'The control is still dirty or touched after `reset()`, so the accessor reported a ' +
            'value back while being reset.'
        );
      }
    },
  },
  {
    name: "renders its control's error once the field has been left",
    applies: (contract) =>
      contract.invalidates !== undefined && contract.errorMessage !== undefined,
    run: async (contract) => {
      const harness = await contract.create();
      contract.invalidates?.(harness);
      harness.fixture.detectChanges();

      const before = host(harness.fixture).querySelector('[role="alert"]');
      if (before !== null) {
        throw new Error(
          `An error is showing before the field has been touched: "${before.textContent?.trim()}". ` +
            'Reporting into a field nobody has reached yet is noise.'
        );
      }

      leave(contract, harness);
      harness.fixture.detectChanges();

      const alert = host(harness.fixture).querySelector('[role="alert"]');
      if (alert === null) {
        throw new Error(
          'The control is invalid and touched, and the accessor renders no error. This is the ' +
            'half of the contract Angular does not give you: a value accessor is told the ' +
            'value and never the validity, so it has to go and read it.'
        );
      }
      const text = alert.textContent?.trim() ?? '';
      if (contract.errorMessage !== undefined && !contract.errorMessage.test(text)) {
        throw new Error(
          `The rendered error is "${text}", which does not match ${String(contract.errorMessage)}.`
        );
      }
    },
  },
];

/**
 * Declare the `ControlValueAccessor` contract as specs, for one accessor.
 *
 * ```ts
 * describe('TagInputComponent', () => {
 *   itHonoursTheValueAccessorContract<string[]>({ create, written: ['a'], rendered, edit });
 * });
 * ```
 *
 * Call it inside a `describe` of its own, one with no `beforeEach` that builds a fixture:
 * each check calls `create` itself, and `TestBed.configureTestingModule` throws once the
 * testing module has been instantiated.
 *
 * Checks the contract does not supply the pieces for — an
 * accessor with nothing to move focus between, one with no validators — are not declared,
 * rather than declared and passed, so the spec count says how much was actually checked.
 *
 * @see `docs/control-value-accessor.md`
 */
export function itHonoursTheValueAccessorContract<TValue>(
  contract: ValueAccessorContract<TValue>
): void {
  const erased = contract as unknown as ValueAccessorContract<never>;
  for (const check of VALUE_ACCESSOR_CHECKS) {
    if (!check.applies(erased)) continue;
    it(check.name, async () => {
      await check.run(erased);
      // Reaching here is the assertion: every check throws on failure. Jasmine reports a
      // spec with no expectations as a warning, so this states the outcome explicitly.
      expect(true).toBeTrue();
    });
  }
}
