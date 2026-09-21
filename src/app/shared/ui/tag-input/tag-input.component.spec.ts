import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import {
  expectSameNodes,
  host,
  itHonoursTheValueAccessorContract,
  requireEl,
  trackedNodes,
} from '@/testing';
import { schemaGroup } from '@/app/core/forms';
import { z } from 'zod';
import { TagInputComponent } from './tag-input.component';

@Component({
  standalone: true,
  imports: [TagInputComponent, ReactiveFormsModule],
  template: `
    <form [formGroup]="form">
      <app-tag-input
        label="Topics"
        [hint]="hint()"
        [minTags]="minTags()"
        [maxTags]="maxTags()"
        formControlName="topics"
      />
    </form>
  `,
})
class HostComponent {
  readonly hint = signal('');
  readonly minTags = signal(0);
  readonly maxTags = signal<number | null>(null);
  readonly form = new FormGroup({
    topics: new FormControl<string[]>([], { nonNullable: true }),
  });
}

function build(): ComponentFixture<HostComponent> {
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  return fixture;
}

function textInput(fixture: ComponentFixture<unknown>): HTMLInputElement {
  return requireEl<HTMLInputElement>(host(fixture), 'input');
}

function chipLabels(fixture: ComponentFixture<unknown>): string[] {
  return Array.from(host(fixture).querySelectorAll('li span')).map(
    (element) => element.textContent?.trim() ?? ''
  );
}

function removeButtons(fixture: ComponentFixture<unknown>): HTMLButtonElement[] {
  return Array.from(host(fixture).querySelectorAll<HTMLButtonElement>('li button'));
}

function alertText(fixture: ComponentFixture<unknown>): string | null {
  return host(fixture).querySelector('[role="alert"]')?.textContent?.trim() ?? null;
}

function statusText(fixture: ComponentFixture<unknown>): string {
  return host(fixture).querySelector('[role="status"]')?.textContent?.trim() ?? '';
}

function type(fixture: ComponentFixture<unknown>, text: string): void {
  const input = textInput(fixture);
  input.value = text;
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

function press(fixture: ComponentFixture<unknown>, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  textInput(fixture).dispatchEvent(event);
  fixture.detectChanges();
  return event;
}

function paste(fixture: ComponentFixture<unknown>, text: string): void {
  const data = new DataTransfer();
  data.setData('text/plain', text);
  textInput(fixture).dispatchEvent(
    new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
  );
  fixture.detectChanges();
}

describe('TagInputComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let component: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = build();
    component = fixture.componentInstance;
  });

  function control() {
    return component.form.controls.topics;
  }

  it('renders a chip per tag in the value', () => {
    control().setValue(['angular', 'forms']);
    fixture.detectChanges();
    expect(chipLabels(fixture)).toEqual(['angular', 'forms']);
  });

  it('commits the tag being typed on Enter', () => {
    type(fixture, 'angular');
    press(fixture, 'Enter');

    expect(control().value).toEqual(['angular']);
    expect(textInput(fixture).value).toBe('');
    expect(chipLabels(fixture)).toEqual(['angular']);
  });

  it('commits on the separator key too', () => {
    type(fixture, 'forms');
    press(fixture, ',');
    expect(control().value).toEqual(['forms']);
  });

  /**
   * Without this the keystroke that commits a tag also submits the form it is in — a
   * single-field form performs implicit submission on Enter.
   */
  it('does not let the committing keystroke submit the form', () => {
    type(fixture, 'angular');
    expect(press(fixture, 'Enter').defaultPrevented).toBeTrue();
  });

  it('trims what it commits, and treats blank as nothing to commit', () => {
    type(fixture, '  spaced  ');
    press(fixture, 'Enter');
    expect(control().value).toEqual(['spaced']);

    type(fixture, '   ');
    press(fixture, 'Enter');
    expect(control().value).toEqual(['spaced']);
    expect(textInput(fixture).value).toBe('');
  });

  /**
   * The heart of the item. The text in the box is not part of the value, so an outer
   * validator cannot see it; only the accessor can, and the only way it has of saying so
   * is `NG_VALIDATORS`.
   */
  it('reports the uncommitted text as an error on the control', () => {
    type(fixture, 'angul');

    expect(control().value).toEqual([]);
    expect(control().valid).toBeFalse();
    expect(control().errors).toEqual({ tagsPending: { text: 'angul' } });
  });

  it('clears that error when the text is committed', () => {
    type(fixture, 'angular');
    press(fixture, 'Enter');
    expect(control().errors).toBeNull();
  });

  it('clears it when the box is emptied instead', () => {
    type(fixture, 'angular');
    type(fixture, '');
    expect(control().errors).toBeNull();
  });

  it('explains the uncommitted text once the field has been left', () => {
    type(fixture, 'angular');
    control().markAsTouched();
    fixture.detectChanges();

    expect(alertText(fixture)).toBe('Press Enter to add “angular”, or clear it.');
  });

  it('refuses a duplicate, and says so without dropping what was typed', () => {
    type(fixture, 'angular');
    press(fixture, 'Enter');
    type(fixture, 'angular');
    press(fixture, 'Enter');

    expect(control().value).toEqual(['angular']);
    expect(textInput(fixture).value).toBe('angular');
    expect(alertText(fixture)).toBe('“angular” is already added.');
  });

  it('stops refusing as soon as the next character is typed', () => {
    type(fixture, 'angular');
    press(fixture, 'Enter');
    type(fixture, 'angular');
    press(fixture, 'Enter');
    expect(alertText(fixture)).not.toBeNull();

    type(fixture, 'angular2');
    expect(alertText(fixture)).toBeNull();
  });

  it('refuses to add past the ceiling', () => {
    component.maxTags.set(1);
    fixture.detectChanges();
    type(fixture, 'angular');
    press(fixture, 'Enter');

    type(fixture, 'forms');
    press(fixture, 'Enter');

    expect(control().value).toEqual(['angular']);
    expect(alertText(fixture)).toBe('Remove one first: at most 1 tag.');
  });

  /**
   * The other side of the same rule: the component never creates a value past the
   * ceiling, and never silently truncates one it is handed.
   */
  it('reports, rather than truncates, a value that arrives past the ceiling', () => {
    component.maxTags.set(2);
    fixture.detectChanges();

    control().setValue(['a', 'b', 'c']);
    fixture.detectChanges();

    expect(chipLabels(fixture)).toEqual(['a', 'b', 'c']);
    expect(control().errors).toEqual({ tagsMax: { max: 2, actual: 3 } });
  });

  it('reports a value below the floor', () => {
    component.minTags.set(1);
    fixture.detectChanges();

    expect(control().errors).toEqual({ tagsMin: { required: 1, actual: 0 } });

    type(fixture, 'angular');
    press(fixture, 'Enter');
    expect(control().errors).toBeNull();
  });

  /**
   * `registerOnValidatorChange`, which is the hook nobody implements. Angular re-runs a
   * validator when the *value* changes; a bound rule changing is invisible to it, so
   * without the callback the control keeps the verdict it reached under the old ceiling.
   */
  it('re-runs its own validators when a bound rule changes under a value that has not', () => {
    component.maxTags.set(2);
    fixture.detectChanges();
    control().setValue(['a', 'b', 'c']);
    fixture.detectChanges();
    expect(control().invalid).toBeTrue();

    component.maxTags.set(5);
    fixture.detectChanges();

    expect(control().errors).toBeNull();
    expect(control().valid).toBeTrue();
  });

  it('removes the last tag on Backspace in an empty box, and not otherwise', () => {
    control().setValue(['angular', 'forms']);
    fixture.detectChanges();

    type(fixture, 'x');
    press(fixture, 'Backspace');
    expect(control().value).toEqual(['angular', 'forms']);

    type(fixture, '');
    press(fixture, 'Backspace');
    expect(control().value).toEqual(['angular']);
  });

  it('removes the tag whose button was pressed', () => {
    control().setValue(['angular', 'forms', 'signals']);
    fixture.detectChanges();

    removeButtons(fixture)[1].click();
    fixture.detectChanges();

    expect(control().value).toEqual(['angular', 'signals']);
  });

  it('splits a pasted list into tags', () => {
    paste(fixture, 'angular, forms\nsignals');
    expect(control().value).toEqual(['angular', 'forms', 'signals']);
  });

  it('leaves a paste with no separator in it to the browser', () => {
    const data = new DataTransfer();
    data.setData('text/plain', 'angular');
    const event = new ClipboardEvent('paste', {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    });
    textInput(fixture).dispatchEvent(event);
    fixture.detectChanges();

    expect(event.defaultPrevented).toBeFalse();
    expect(control().value).toEqual([]);
  });

  it('stops a paste at the first entry it has to refuse', () => {
    paste(fixture, 'angular,angular,forms');

    expect(control().value).toEqual(['angular']);
    expect(textInput(fixture).value).toBe('angular');
  });

  it('announces additions and removals politely', () => {
    type(fixture, 'angular');
    press(fixture, 'Enter');
    expect(statusText(fixture)).toBe('Added angular');

    removeButtons(fixture)[0].click();
    fixture.detectChanges();
    expect(statusText(fixture)).toBe('Removed angular');
  });

  it('disables its remove buttons along with the text box', () => {
    control().setValue(['angular']);
    fixture.detectChanges();
    control().disable();
    fixture.detectChanges();

    expect(textInput(fixture).disabled).toBeTrue();
    expect(removeButtons(fixture)[0].disabled).toBeTrue();
  });

  /**
   * The control's value must not be the array this component renders from, or a caller
   * doing `form.value.topics.push('x')` rewrites the component's state with no change
   * detection and no event.
   */
  it('hands out a copy rather than the array it renders from', () => {
    control().setValue(['angular']);
    fixture.detectChanges();
    type(fixture, 'forms');
    press(fixture, 'Enter');

    control().value.push('smuggled');
    fixture.detectChanges();

    expect(chipLabels(fixture)).toEqual(['angular', 'forms']);
  });

  it('keeps the same array out of the value it was given', () => {
    const given = ['angular'];
    control().setValue(given);
    fixture.detectChanges();
    given.push('smuggled');
    fixture.detectChanges();

    expect(chipLabels(fixture)).toEqual(['angular']);
  });

  /**
   * `track tag` and not `track $index`. Tracking by position hands the removed chip's DOM
   * node — and anything attached to it, focus included — to the tag that shuffles up into
   * its place.
   */
  it('keeps the surviving chips’ DOM nodes when one is removed from the middle', () => {
    control().setValue(['angular', 'forms', 'signals']);
    fixture.detectChanges();
    const before = trackedNodes(fixture, 'li');

    removeButtons(fixture)[1].click();
    fixture.detectChanges();

    const after = trackedNodes(fixture, 'li');
    expectSameNodes([before[0], before[2]], after);
  });

  it('puts focus on the chip that took the removed one’s place', async () => {
    control().setValue(['angular', 'forms', 'signals']);
    fixture.detectChanges();

    removeButtons(fixture)[0].click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.activeElement).toBe(removeButtons(fixture)[0]);
    expect(removeButtons(fixture)[0].getAttribute('aria-label')).toBe('Remove forms');
  });

  it('falls back to the text box when the last chip is removed', async () => {
    control().setValue(['angular']);
    fixture.detectChanges();

    removeButtons(fixture)[0].click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.activeElement).toBe(textInput(fixture));
  });

  it('describes the box by its hint and its message together', () => {
    component.hint.set('Press Enter after each one.');
    fixture.detectChanges();
    const hintId = requireEl<HTMLElement>(host(fixture), 'p').id;
    expect(textInput(fixture).getAttribute('aria-describedby')).toBe(hintId);

    type(fixture, 'angular');
    control().markAsTouched();
    fixture.detectChanges();

    expect(textInput(fixture).getAttribute('aria-describedby')?.split(' ').length).toBe(2);
    expect(textInput(fixture).getAttribute('aria-invalid')).toBe('true');
  });

  it('labels the field and every remove button', () => {
    control().setValue(['angular']);
    fixture.detectChanges();

    const label = requireEl<HTMLLabelElement>(host(fixture), 'label');
    expect(label.textContent?.trim()).toBe('Topics');
    expect(label.htmlFor).toBe(textInput(fixture).id);
    expect(removeButtons(fixture)[0].getAttribute('aria-label')).toBe('Remove angular');
  });

  it('explains a value below the floor, and above the ceiling, in words', () => {
    component.minTags.set(2);
    fixture.detectChanges();
    control().markAsTouched();
    fixture.detectChanges();
    expect(alertText(fixture)).toBe('Add at least 2 tags.');

    component.minTags.set(0);
    component.maxTags.set(1);
    control().setValue(['angular', 'forms']);
    fixture.detectChanges();
    expect(alertText(fixture)).toBe('Remove some: at most 1 tag.');
  });

  it('skips the empty entries in a pasted list', () => {
    paste(fixture, 'angular,,forms');
    expect(control().value).toEqual(['angular', 'forms']);
  });

  it('does nothing with a paste that carries no text', () => {
    textInput(fixture).dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true })
    );
    fixture.detectChanges();
    expect(control().value).toEqual([]);
  });

  it('keeps the chip list a list even where CSS would stop it being one', () => {
    control().setValue(['angular']);
    fixture.detectChanges();
    expect(requireEl<HTMLElement>(host(fixture), 'ul').getAttribute('role')).toBe('list');
  });
});

/**
 * The shared contract, in a `describe` of its own: each check builds its own fixture, so
 * it must not sit under a `beforeEach` that has already instantiated the TestBed.
 */
describe('TagInputComponent as a value accessor', () => {
  itHonoursTheValueAccessorContract<string[]>({
    create: async () => {
      await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
      const fixture = build();
      return {
        fixture,
        control: fixture.componentInstance.form.controls.topics,
        element: requireEl<HTMLElement>(host(fixture), 'app-tag-input'),
      };
    },
    written: ['angular', 'forms'],
    rendered: (harness) =>
      Array.from(harness.element.querySelectorAll('li span')).map(
        (element) => element.textContent?.trim() ?? ''
      ),
    edit: (harness) => {
      const input = requireEl<HTMLInputElement>(harness.element, 'input');
      input.value = 'signals';
      input.dispatchEvent(new Event('input'));
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      );
    },
    // Tabbing from the text box to a chip's own remove button. `blur` would not bubble to
    // the host at all, and `focusout` without this check counts it as leaving the field.
    internalFocusMove: (harness) => {
      const input = requireEl<HTMLInputElement>(harness.element, 'input');
      input.value = 'angular';
      input.dispatchEvent(new Event('input'));
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      );
      harness.fixture.detectChanges();

      const button = requireEl<HTMLButtonElement>(harness.element, 'li button');
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: button }));
    },
    invalidates: (harness) => {
      const input = requireEl<HTMLInputElement>(harness.element, 'input');
      input.value = 'half-typed';
      input.dispatchEvent(new Event('input'));
    },
    errorMessage: /Press Enter to add/,
  });
});

/**
 * A nullable control, which is what `FormControl<string[] | null>` and a bare `reset()`
 * produce. The accessor is handed `null` and has to render an empty field rather than
 * throw, and its validator has to answer about a value that is not an array.
 */
@Component({
  standalone: true,
  imports: [TagInputComponent, ReactiveFormsModule],
  template: `<app-tag-input label="Topics" [minTags]="1" [formControl]="control" />`,
})
class NullableHostComponent {
  readonly control = new FormControl<string[] | null>(['angular']);
}

describe('TagInputComponent bound to a nullable control', () => {
  it('renders an emptied field, and still answers for the value it was given', () => {
    const fixture = TestBed.createComponent(NullableHostComponent);
    fixture.detectChanges();
    expect(host(fixture).querySelectorAll('li').length).toBe(1);

    fixture.componentInstance.control.setValue(null);
    fixture.detectChanges();

    expect(host(fixture).querySelectorAll('li').length).toBe(0);
    expect(fixture.componentInstance.control.errors).toEqual({
      tagsMin: { required: 1, actual: 0 },
    });
  });
});

/**
 * The accessor against the repo's own schema-driven forms, which is where both halves of
 * the contract meet: the schema's rule and the component's arrive on the same control,
 * and the component's — the one no validator above it could have checked — is the one
 * reported.
 */
@Component({
  standalone: true,
  imports: [TagInputComponent, ReactiveFormsModule],
  template: `
    <form [formGroup]="form">
      <app-tag-input label="Topics" formControlName="topics" />
    </form>
  `,
})
class SchemaHostComponent {
  readonly form = schemaGroup(
    z.object({ topics: z.array(z.string()).min(1, 'Pick at least one topic') }),
    { topics: [] }
  );
}

describe('TagInputComponent in a schema-built form', () => {
  let fixture: ComponentFixture<SchemaHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SchemaHostComponent] }).compileComponents();
    fixture = TestBed.createComponent(SchemaHostComponent);
    fixture.detectChanges();
  });

  it('reports the schema\u2019s rule when that is all that is wrong', () => {
    fixture.componentInstance.form.markAllAsTouched();
    fixture.detectChanges();

    expect(alertText(fixture)).toBe('Pick at least one topic');
  });

  it('prefers its own rule, which the schema could not have seen', () => {
    const input = requireEl<HTMLInputElement>(host(fixture), 'input');
    input.value = 'angular';
    input.dispatchEvent(new Event('input'));
    fixture.componentInstance.form.markAllAsTouched();
    fixture.detectChanges();

    const control = fixture.componentInstance.form.controls.topics;
    expect(Object.keys(control.errors ?? {}).sort()).toEqual(['tagsPending', 'zod']);
    expect(alertText(fixture)).toBe('Press Enter to add \u201Cangular\u201D, or clear it.');
  });
});
