import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { InputComponent } from './input.component';
import { Component, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

/**
 * Host state is held in signals, not plain fields. TestBed runs zoneless by default in
 * Angular 22, so `fixture.detectChanges()` only refreshes views that something marked
 * dirty — writing a signal does that, assigning to a field does not.
 */
@Component({
  standalone: true,
  imports: [InputComponent, ReactiveFormsModule],
  template: `
    <app-input
      [label]="label()"
      [error]="error()"
      [placeholder]="placeholder()"
      [formControl]="control"
    />
  `,
})
class HostComponent {
  readonly label = signal('Email');
  readonly error = signal('');
  readonly placeholder = signal('Enter value');
  readonly control = new FormControl('');
}

describe('InputComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders an input element', () => {
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    expect(input).toBeTruthy();
  });

  it('renders the label', () => {
    const label = fixture.nativeElement.querySelector('label') as HTMLLabelElement;
    expect(label.textContent?.trim()).toBe('Email');
  });

  it('connects label to input via for/id', () => {
    const label = fixture.nativeElement.querySelector('label') as HTMLLabelElement;
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    expect(label.htmlFor).toBe(input.id);
  });

  it('displays error message', () => {
    host.error.set('Required');
    fixture.detectChanges();
    const error = fixture.nativeElement.querySelector('[role="alert"]') as HTMLElement;
    expect(error.textContent?.trim()).toBe('Required');
  });

  it('marks input invalid when error present', () => {
    host.error.set('Invalid');
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('does not render label element when label is empty', () => {
    host.label.set('');
    fixture.detectChanges();
    const label = fixture.nativeElement.querySelector('label');
    expect(label).toBeNull();
  });

  it('updates form control on input', () => {
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = 'test@example.com';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(host.control.value).toBe('test@example.com');
  });

  it('disables input when control is disabled', () => {
    host.control.disable();
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    expect(input.disabled).toBeTrue();
  });
});
