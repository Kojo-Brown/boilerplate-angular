import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ButtonComponent } from './button.component';
import { Component } from '@angular/core';

@Component({
  standalone: true,
  imports: [ButtonComponent],
  template: `<app-button [variant]="variant" [size]="size" [loading]="loading" [disabled]="disabled">Click</app-button>`,
})
class HostComponent {
  variant: ButtonComponent['variant'] = 'primary';
  size: ButtonComponent['size'] = 'md';
  loading = false;
  disabled = false;
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
    host.disabled = true;
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(btn.disabled).toBeTrue();
  });

  it('disables button when loading=true', () => {
    host.loading = true;
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(btn.disabled).toBeTrue();
  });

  it('shows spinner when loading', () => {
    host.loading = true;
    fixture.detectChanges();
    const spinner = fixture.nativeElement.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(spinner).toBeTruthy();
  });

  it('applies primary variant classes by default', () => {
    const btn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(btn.className).toContain('bg-[var(--color-primary)]');
  });

  it('applies secondary variant classes', () => {
    host.variant = 'secondary';
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(btn.className).toContain('bg-[var(--color-secondary)]');
  });

  it('applies destructive variant classes', () => {
    host.variant = 'destructive';
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(btn.className).toContain('bg-[var(--color-destructive)]');
  });

  it('applies size classes', () => {
    host.size = 'lg';
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(btn.className).toContain('h-12');
  });
});
