import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  forwardRef,
  inject,
  Injector,
  input,
  signal,
  untracked,
  viewChild,
  viewChildren,
} from '@angular/core';
import { NG_VALIDATORS, NG_VALUE_ACCESSOR } from '@angular/forms';
import type {
  AbstractControl,
  ControlValueAccessor,
  ValidationErrors,
  Validator,
} from '@angular/forms';
import { hostControl } from '@/app/core/forms';
import type { FieldErrorMessages } from '@/app/core/forms';

let nextId = 0;

const FIELD_BASE =
  'flex w-full flex-wrap items-center gap-1.5 rounded-[var(--radius)] border px-2 py-1.5 ' +
  'bg-[var(--color-background)] transition-colors ' +
  'focus-within:ring-2 focus-within:ring-[var(--color-primary)]';

const CHIP_CLASSES =
  'inline-flex items-center gap-1 rounded-[var(--radius)] ' +
  'bg-[var(--color-muted)] py-0.5 pl-2 pr-0.5 text-xs text-[var(--color-foreground)]';

const CHIP_REMOVE_CLASSES =
  'rounded-[var(--radius)] px-1 leading-none text-[var(--color-muted-foreground)] ' +
  'transition-colors hover:text-[var(--color-foreground)] ' +
  'focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

const TEXT_INPUT_CLASSES =
  'min-w-[8rem] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm ' +
  'text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] ' +
  'focus:outline-none disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Messages for the three error keys {@link TagInputComponent} contributes.
 *
 * Exported so an application replacing {@link FIELD_ERROR_MESSAGES} wholesale — for
 * localisation, say — can see what it has to cover, and so a spec can assert a message
 * without copying the string.
 */
export const TAG_INPUT_ERROR_MESSAGES: FieldErrorMessages = {
  tagsPending: (detail) => {
    const text = typeof detail === 'object' && detail !== null ? Reflect.get(detail, 'text') : null;
    return typeof text === 'string'
      ? `Press Enter to add “${text}”, or clear it.`
      : 'Finish the tag you are typing, or clear it.';
  },
  tagsMin: (detail) => {
    const required =
      typeof detail === 'object' && detail !== null ? Reflect.get(detail, 'required') : null;
    const count = typeof required === 'number' ? required : 1;
    return `Add at least ${count} ${count === 1 ? 'tag' : 'tags'}.`;
  },
  tagsMax: (detail) => {
    const max = typeof detail === 'object' && detail !== null ? Reflect.get(detail, 'max') : null;
    const count = typeof max === 'number' ? max : 0;
    return `Remove some: at most ${count} ${count === 1 ? 'tag' : 'tags'}.`;
  },
};

/**
 * A list of short strings, edited as chips, bound to a `FormControl<string[]>`.
 *
 * ```html
 * <app-tag-input label="Topics" formControlName="topics" [maxTags]="5" />
 * ```
 *
 * This is the component the Phase 9 item is about, and a tag editor is the example
 * because it is the smallest widget that needs *both* directions of the contract. The
 * simple direction — rendering the control's errors — is
 * {@link file://../input/input.component.ts | InputComponent}. This one also has rules of
 * its own, and it is the only thing in the application that can enforce them.
 *
 * ## The uncommitted buffer, and why it is a validator
 *
 * A tag input has a text box that is *not* part of its value. Type `angular`, do not press
 * Enter, submit: the control's value is `[]`, every outer validator agrees the field is
 * fine, and the visitor watches the word they typed disappear. Nothing above this
 * component can see that text — it is not in the value, it is not in the DOM the form
 * knows about, and `form.valid` is `true`.
 *
 * So the buffer is reported as a validation error (`tagsPending`) through `NG_VALIDATORS`,
 * which is what `NG_VALIDATORS` is *for*: a rule that only the accessor is in a position
 * to check. Committing on blur would be the other answer, and it is worse — it turns a
 * half-typed word the visitor was about to delete into a permanent tag, silently, on a
 * click anywhere else on the page.
 *
 * ## Why `minTags`/`maxTags` are validators too, when the component already refuses
 *
 * Refusing the keystroke handles the one case the component causes. It does not handle
 * `patchValue(['a','b','c','d','e','f'])` from a resolver, a draft restored from storage,
 * or a server response — all of which arrive through `writeValue`, where truncating
 * someone else's data silently would be the worse sin. So the component never *creates* a
 * value outside the bounds and always *reports* one it was handed.
 *
 * ## Three things that look like details and are not
 *
 * - **`focusout`, not `blur`.** `blur` does not bubble, so a host listener never hears
 *   the inner input lose focus. `focusout` does — and then has to check `relatedTarget`,
 *   because tabbing from the text box to a chip's remove button is not leaving the field,
 *   and marking the control touched there shows "Add at least one tag" at someone in the
 *   middle of adding one.
 * - **Enter calls `preventDefault`.** Otherwise a single-field form submits on the
 *   keystroke that was meant to commit the tag.
 * - **Focus after removing a chip.** Removing the node that has focus sends focus to
 *   `<body>`, which for a keyboard user means the next Tab starts from the top of the
 *   page. Focus moves to the chip that took its place, or the text box if it was the
 *   last one.
 *
 * @see `docs/control-value-accessor.md`
 */
@Component({
  selector: 'app-tag-input',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Both halves of the contract, declared. `NG_VALIDATORS` is the reason this component
  // cannot inject `NgControl` in its constructor — see `hostControl`.
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => TagInputComponent),
      multi: true,
    },
    {
      provide: NG_VALIDATORS,
      useExisting: forwardRef(() => TagInputComponent),
      multi: true,
    },
  ],
  host: { class: 'block', '(focusout)': 'onFocusOut($event)' },
  template: `
    <div class="flex flex-col gap-1">
      <label [for]="inputId" class="text-sm font-medium text-[var(--color-foreground)]">
        {{ label() }}
      </label>

      <div [class]="fieldClasses()">
        @if (tags().length > 0) {
          <!--
            \`role="list"\` on a \`<ul>\` that is not styled as one: Safari drops list
            semantics from a list with \`list-style: none\`, and these chips are laid out
            with flex. Without it the remove buttons are announced with no container.
          -->
          <ul role="list" class="contents">
            <!--
              track: tags are strings and the value is the identity — a duplicate cannot
              exist (\`rejectionFor\` refuses one) so the value is unique, and it is also
              the only thing a tag has. Tracking by \`$index\` here would hand one chip's
              DOM node, and its focus, to a different tag as soon as one is removed from
              the middle.
            -->
            @for (tag of tags(); track tag; let index = $index) {
              <li [class]="chipClasses">
                <span>{{ tag }}</span>
                <button
                  #removeButton
                  type="button"
                  [disabled]="isDisabled()"
                  [attr.aria-label]="'Remove ' + tag"
                  [class]="chipRemoveClasses"
                  (click)="remove(index)"
                >
                  ×
                </button>
              </li>
            }
          </ul>
        }

        <input
          #textInput
          [id]="inputId"
          type="text"
          autocomplete="off"
          [placeholder]="placeholder()"
          [disabled]="isDisabled()"
          [value]="pending()"
          [attr.aria-invalid]="showsError() ? 'true' : null"
          [attr.aria-describedby]="describedBy()"
          [class]="textInputClasses"
          (input)="onInput($event)"
          (keydown)="onKeydown($event)"
          (paste)="onPaste($event)"
        />
      </div>

      @if (hint() !== '') {
        <p [id]="hintId" class="text-xs text-[var(--color-muted-foreground)]">{{ hint() }}</p>
      }
      @if (message(); as text) {
        <p [id]="errorId" role="alert" class="text-xs text-[var(--color-destructive)]">
          {{ text }}
        </p>
      }

      <!--
        Additions and removals are announced politely. The refusal above is a \`role="alert"\`
        instead, because it is a response to something the visitor just tried to do.
      -->
      <p role="status" aria-live="polite" class="sr-only">{{ announcement() }}</p>
    </div>
  `,
})
export class TagInputComponent implements ControlValueAccessor, Validator {
  /**
   * Required, because the field is a text box with no visible name of its own and an
   * unlabelled one is unusable with a screen reader. A required signal input makes that
   * a compile error rather than an audit finding.
   */
  readonly label = input.required<string>();
  readonly placeholder = input('Add a tag…');
  /** Standing guidance under the field — "Press Enter after each tag", typically. */
  readonly hint = input('');
  /** Fewest tags the value may hold. `0` means the field is optional. */
  readonly minTags = input(0);
  /** Most tags the value may hold, or `null` for no ceiling. */
  readonly maxTags = input<number | null>(null);
  /**
   * Character that commits the tag being typed, alongside Enter, and splits a pasted
   * list. One character: it is compared against `KeyboardEvent.key`.
   */
  readonly separator = input(',');

  private readonly id = ++nextId;
  protected readonly inputId = `app-tag-input-${this.id}`;
  protected readonly hintId = `app-tag-input-${this.id}-hint`;
  protected readonly errorId = `app-tag-input-${this.id}-error`;

  protected readonly chipClasses = CHIP_CLASSES;
  protected readonly chipRemoveClasses = CHIP_REMOVE_CLASSES;
  protected readonly textInputClasses = TEXT_INPUT_CLASSES;

  private readonly injector = inject(Injector);
  private readonly hostElement = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  private readonly removeButtons = viewChildren<ElementRef<HTMLButtonElement>>('removeButton');
  private readonly textInput = viewChild.required<ElementRef<HTMLInputElement>>('textInput');

  private readonly field = hostControl({
    label: () => this.label(),
    messages: TAG_INPUT_ERROR_MESSAGES,
  });

  /** The committed value, mirrored for rendering. */
  protected readonly tags = signal<readonly string[]>([]);
  /** The text in the box, which is deliberately *not* part of the value. */
  protected readonly pending = signal('');
  protected readonly isDisabled = signal(false);
  /** Why the last attempt to commit was refused, cleared by the next edit. */
  protected readonly rejection = signal<string | null>(null);
  protected readonly announcement = signal('');

  /**
   * The refusal if there is one, otherwise the control's error.
   *
   * One slot rather than two: a refused keystroke and a failing validator are the same
   * thing to the person reading the screen, and stacking them puts "already added" above
   * "press Enter to add it" — two sentences about the same word, contradicting each
   * other. The refusal wins because it is the more specific answer to what was just
   * attempted.
   */
  protected readonly message = computed(() => this.rejection() ?? this.field.errorMessage());
  protected readonly showsError = computed(
    () => this.rejection() !== null || this.field.showsError()
  );

  protected readonly describedBy = computed(() => {
    const ids = [
      ...(this.hint() === '' ? [] : [this.hintId]),
      ...(this.message() === null ? [] : [this.errorId]),
    ];
    return ids.length === 0 ? null : ids.join(' ');
  });

  protected readonly fieldClasses = computed(() => {
    const border = this.showsError()
      ? 'border-[var(--color-destructive)]'
      : 'border-[var(--color-border)]';
    return `${FIELD_BASE} ${border}`;
  });

  private onChange: (value: string[]) => void = () => {};
  private onTouched: () => void = () => {};
  private onValidatorChange: () => void = () => {};

  /**
   * Re-run validation when a *bound rule* changes, which Angular does not do by itself.
   *
   * `[maxTags]` going from 5 to 10 changes the answer this component gives for a value
   * that has not moved, and nothing asks it again: the control keeps the verdict from the
   * last time its value or status changed, so a field stays red under a limit that no
   * longer exists. `registerOnValidatorChange` is the callback that invalidates it, and
   * this is the only place that can know when to call it.
   *
   * `untracked` is load-bearing. The callback runs `updateValueAndValidity` synchronously,
   * which calls this component's own `validate` — so without it, every signal `validate`
   * reads (`pending`, both bounds) becomes a dependency of this effect, and typing a
   * character starts re-running a revalidation that the keystroke handler has already
   * done.
   */
  private readonly revalidateOnBoundsChange = effect(() => {
    this.minTags();
    this.maxTags();
    untracked(() => this.onValidatorChange());
  });

  writeValue(value: readonly string[] | null): void {
    // First line: the one hook where the control is reachable under both `[formControl]`
    // and `formControlName`. See `hostControl`.
    this.field.connect();

    // Copied in, and copied out again in `emit`. Holding the caller's array would mean a
    // `form.value.tags.push(…)` anywhere in the application silently rewrites what this
    // component is rendering, with no change detection and no event.
    this.tags.set(Array.isArray(value) ? [...value] : []);

    // A new value replaces the edit in progress. No `onValidatorChange` call is needed
    // for it: `setValue` and `reset` both write through the accessor *before* running
    // `updateValueAndValidity`, so the cleared buffer is what the validator sees. Calling
    // it from here would also re-enter validation in the middle of `setUpControl`.
    this.pending.set('');
    this.rejection.set(null);
  }

  registerOnChange(fn: (value: string[]) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  registerOnValidatorChange(fn: () => void): void {
    this.onValidatorChange = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.isDisabled.set(isDisabled);
  }

  /**
   * The rules only this component can check, read off the control rather than off
   * {@link tags} — a validator validates the control it is given, which during
   * `setUpControl` holds the value before this component has been told about it.
   */
  validate(control: AbstractControl): ValidationErrors | null {
    const value: readonly unknown[] = Array.isArray(control.value) ? control.value : [];
    const errors: ValidationErrors = {};

    const pending = this.pending().trim();
    if (pending !== '') errors['tagsPending'] = { text: pending };

    const min = this.minTags();
    if (value.length < min) errors['tagsMin'] = { required: min, actual: value.length };

    const max = this.maxTags();
    if (max !== null && value.length > max) errors['tagsMax'] = { max, actual: value.length };

    return Object.keys(errors).length === 0 ? null : errors;
  }

  protected onInput(event: Event): void {
    this.setPending((event.target as HTMLInputElement).value);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === this.separator()) {
      // Enter in a single-field form submits it. The keystroke that commits a tag is not
      // the keystroke that submits the form it is in.
      event.preventDefault();
      this.commit(this.pending());
      return;
    }

    if (event.key === 'Backspace' && this.pending() === '' && this.tags().length > 0) {
      this.remove(this.tags().length - 1);
    }
  }

  /**
   * A pasted list becomes tags, rather than one tag with commas in it.
   *
   * Text with no separator in it is left to the browser: intercepting it would break
   * pasting into the middle of a half-typed word, which is the common case.
   */
  protected onPaste(event: ClipboardEvent): void {
    const text = event.clipboardData?.getData('text/plain') ?? '';
    const parts = text.split('\n').flatMap((line) => line.split(this.separator()));
    if (parts.length < 2) return;

    event.preventDefault();
    for (const part of parts) {
      if (part.trim() === '') continue;
      // Stops at the first refusal, leaving it in the box: the same place a refused
      // keystroke leaves it, so the message and `tagsPending` describe the same word.
      if (!this.commit(part)) return;
    }
  }

  protected remove(index: number): void {
    const current = this.tags();
    const removed = current[index];
    if (removed === undefined || this.isDisabled()) return;

    this.emit(current.filter((_, position) => position !== index));
    this.announcement.set(`Removed ${removed}`);
    this.focusAfterRemoval(index);
  }

  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    // Moving between this field's own controls is not leaving it. `relatedTarget` is also
    // `null` when focus leaves the document entirely — switching tab or window — and that
    // counts as leaving: the visitor is done with the field either way.
    if (next instanceof Node && this.hostElement.contains(next)) return;
    this.onTouched();
  }

  /** Commits `text` as a tag. Returns whether it was accepted. */
  private commit(text: string): boolean {
    const tag = text.trim();
    if (tag === '') {
      // Whitespace is not a tag and not a refusal either — just clear the box.
      this.setPending('');
      return true;
    }

    const rejection = this.rejectionFor(tag);
    if (rejection !== null) {
      // The text stays in the box on purpose: it is what the message is about, and
      // `tagsPending` keeps the form from being submitted while it sits there.
      this.setPending(text);
      this.rejection.set(rejection);
      return false;
    }

    this.emit([...this.tags(), tag]);
    this.setPending('');
    this.announcement.set(`Added ${tag}`);
    return true;
  }

  /** Why `tag` cannot be added, or `null` if it can. */
  private rejectionFor(tag: string): string | null {
    if (this.tags().includes(tag)) return `“${tag}” is already added.`;

    const max = this.maxTags();
    if (max !== null && this.tags().length >= max) {
      return `Remove one first: at most ${max} ${max === 1 ? 'tag' : 'tags'}.`;
    }

    return null;
  }

  private setPending(text: string): void {
    this.pending.set(text);
    this.rejection.set(null);
    // `pending` is half of what `validate` answers with, and it changes without the
    // control's value changing — so nothing else would ask the validator again.
    this.onValidatorChange();
  }

  private emit(next: readonly string[]): void {
    this.tags.set(next);
    this.rejection.set(null);
    // A copy, for the reason `writeValue` copies in: the control's value must not be the
    // array this component goes on rendering from.
    this.onChange([...next]);
  }

  /**
   * Put focus where the removed chip was.
   *
   * After the view has been rebuilt, or the buttons queried are the ones about to be
   * destroyed. `afterNextRender` does not run on the server, which is correct — there is
   * nothing focused there to rescue.
   */
  private focusAfterRemoval(index: number): void {
    afterNextRender(
      () => {
        const buttons = this.removeButtons();
        const target = buttons[index] ?? this.textInput();
        target.nativeElement.focus();
      },
      { injector: this.injector }
    );
  }
}
