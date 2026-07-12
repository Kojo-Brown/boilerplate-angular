import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DialogComponent } from './dialog.component';
import { DialogRef } from '@angular/cdk/dialog';
import { Component } from '@angular/core';

@Component({
  standalone: true,
  imports: [DialogComponent],
  template: `<app-dialog [title]="title"><p>Dialog content</p></app-dialog>`,
})
class HostComponent {
  title = 'Test Dialog';
}

describe('DialogComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const mockDialogRef = { close: jasmine.createSpy('close') };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{ provide: DialogRef, useValue: mockDialogRef }],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders dialog container', () => {
    const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).toBeTruthy();
  });

  it('renders title', () => {
    const title = fixture.nativeElement.querySelector('#dialog-title') as HTMLElement;
    expect(title.textContent?.trim()).toBe('Test Dialog');
  });

  it('does not render title element when title is empty', () => {
    host.title = '';
    fixture.detectChanges();
    const title = fixture.nativeElement.querySelector('#dialog-title');
    expect(title).toBeNull();
  });

  it('renders projected content', () => {
    const content = fixture.nativeElement.querySelector('p') as HTMLElement;
    expect(content.textContent?.trim()).toBe('Dialog content');
  });

  it('renders close button', () => {
    const btn = fixture.nativeElement.querySelector('[aria-label="Close dialog"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
  });

  it('calls dialogRef.close() when close button clicked', () => {
    const btn = fixture.nativeElement.querySelector('[aria-label="Close dialog"]') as HTMLButtonElement;
    btn.click();
    expect(mockDialogRef.close).toHaveBeenCalled();
  });
});
