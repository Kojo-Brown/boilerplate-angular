import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { host, requireEl } from '@/testing';
import { StatWidgetComponent } from './stat-widget.component';

describe('StatWidgetComponent', () => {
  let fixture: ComponentFixture<StatWidgetComponent>;

  beforeEach(() => {
    fixture = TestBed.createComponent(StatWidgetComponent);
    fixture.componentRef.setInput('label', 'Revenue');
    fixture.componentRef.setInput('value', 18420);
    fixture.detectChanges();
  });

  it('formats a plain count with thousands separators', () => {
    expect(host(fixture).textContent).toContain('18,420');
  });

  it('formats as currency when one is given', () => {
    fixture.componentRef.setInput('currency', 'USD');
    fixture.detectChanges();
    expect(host(fixture).textContent).toContain('$18,420.00');
  });

  it('describes a rise, a fall and no change', () => {
    expect(host(fixture).textContent).toContain('No change');

    fixture.componentRef.setInput('delta', 0.084);
    fixture.detectChanges();
    expect(host(fixture).textContent).toContain('Up 8.4%');

    fixture.componentRef.setInput('delta', -0.021);
    fixture.detectChanges();
    expect(host(fixture).textContent).toContain('Down 2.1%');
  });

  it('hides its body when collapsed and says so on the toggle', () => {
    const toggle = requireEl<HTMLButtonElement>(host(fixture), 'header button');
    expect(toggle.textContent?.trim()).toBe('Hide');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    toggle.click();
    fixture.detectChanges();

    expect(host(fixture).textContent).not.toContain('18,420');
    expect(toggle.textContent?.trim()).toBe('Show');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(fixture.componentInstance.collapsed()).toBeTrue();
  });

  it('emits its label when the breakdown is chosen', () => {
    const emitted: string[] = [];
    fixture.componentInstance.select.subscribe((value) => emitted.push(value));

    requireEl<HTMLButtonElement>(host(fixture), 'section > button').click();

    expect(emitted).toEqual(['Revenue']);
  });
});
