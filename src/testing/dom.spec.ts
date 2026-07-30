import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { fillInput, host, requireEl } from './dom';

@Component({
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <input id="email" [formControl]="control" />
    @if (showExtra()) {
      <span id="extra">extra</span>
    }
  `,
})
class HostComponent {
  readonly control = new FormControl('');
  readonly showExtra = signal(false);
}

describe('DOM test helpers', () => {
  function createFixture() {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('host() returns the fixture root as a typed HTMLElement', () => {
    const el = host(createFixture());
    expect(el instanceof HTMLElement).toBeTrue();
    expect(el.querySelector('#email')).toBeTruthy();
  });

  it('requireEl() returns the matching element', () => {
    const input = requireEl<HTMLInputElement>(host(createFixture()), '#email');
    expect(input.id).toBe('email');
  });

  it('requireEl() throws naming the selector when the element is absent', () => {
    const el = host(createFixture());
    expect(() => requireEl(el, '#missing')).toThrowError(/#missing/);
  });

  it('fillInput() sets the value and notifies the bound form control', () => {
    const fixture = createFixture();
    fillInput(host(fixture), '#email', 'user@example.com');
    expect(fixture.componentInstance.control.value).toBe('user@example.com');
  });

  it('fillInput() throws when the target input is absent', () => {
    const el = host(createFixture());
    expect(() => fillInput(el, '#missing', 'x')).toThrowError(/#missing/);
  });
});
