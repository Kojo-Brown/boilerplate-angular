import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { ButtonComponent } from './button.component';
import { Component, signal } from '@angular/core';

/**
 * Host state is held in signals, not plain fields. TestBed runs zoneless by default in
 * Angular 22, so `fixture.detectChanges()` only refreshes views that something marked
 * dirty — writing a signal does that, assigning to a field does not.
 */
@Component({
  standalone: true,
  imports: [ButtonComponent],
  template: `<app-button
    [variant]="variant()"
    [size]="size()"
    [loading]="loading()"
    [disabled]="disabled()"
    >Click</app-button
  >`,
})
class HostComponent {
  readonly variant = signal<ButtonComponent['variant']>('primary');
  readonly size = signal<ButtonComponent['size']>('md');
  readonly loading = signal(false);
  readonly disabled = signal(false);
}

describe('ButtonComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders a button element', () => {
    const btn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(btn).toBeTruthy();
  });

  it('projects content', () => {
    const btn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(btn.textContent?.trim()).toContain('Click');
  });

  it('disables button when disabled=true', () => {
    host.disabled.set(true);
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(btn.disabled).toBeTrue();
  });

  it('disables button when loading=true', () => {
    host.loading.set(true);
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(btn.disabled).toBeTrue();
  });

  it('shows spinner when loading', () => {
    host.loading.set(true);
    fixture.detectChanges();
    const spinner = fixture.nativeElement.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(spinner).toBeTruthy();
  });

  it('applies primary variant classes by default', () => {
    const btn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(btn.className).toContain('bg-[var(--color-primary)]');
  });

  it('applies secondary variant classes', () => {
    host.variant.set('secondary');
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(btn.className).toContain('bg-[var(--color-secondary)]');
  });

  it('applies destructive variant classes', () => {
    host.variant.set('destructive');
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(btn.className).toContain('bg-[var(--color-destructive)]');
  });

  it('applies size classes', () => {
    host.size.set('lg');
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(btn.className).toContain('h-12');
  });
});
