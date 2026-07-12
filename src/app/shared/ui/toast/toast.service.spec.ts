import { TestBed } from '@angular/core/testing';
import { ToastService } from './toast.service';

describe('ToastService', () => {
  let service: ToastService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ToastService);
    jasmine.clock().install();
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  it('is created', () => {
    expect(service).toBeTruthy();
  });

  it('starts with empty toasts', () => {
    expect(service.toasts()).toEqual([]);
  });

  it('adds a toast on show()', () => {
    service.show({ message: 'Hello', type: 'success' });
    expect(service.toasts().length).toBe(1);
    expect(service.toasts()[0].message).toBe('Hello');
    expect(service.toasts()[0].type).toBe('success');
  });

  it('defaults type to info', () => {
    service.show({ message: 'Test' });
    expect(service.toasts()[0].type).toBe('info');
  });

  it('removes toast after duration', () => {
    service.show({ message: 'Bye', duration: 1000 });
    expect(service.toasts().length).toBe(1);
    jasmine.clock().tick(1001);
    expect(service.toasts().length).toBe(0);
  });

  it('dismiss() removes toast by id', () => {
    const id = service.show({ message: 'To remove' });
    service.dismiss(id);
    expect(service.toasts().length).toBe(0);
  });

  it('success() creates success toast', () => {
    service.success('Saved!');
    expect(service.toasts()[0].type).toBe('success');
  });

  it('error() creates error toast', () => {
    service.error('Failed!');
    expect(service.toasts()[0].type).toBe('error');
  });

  it('warning() creates warning toast', () => {
    service.warning('Watch out!');
    expect(service.toasts()[0].type).toBe('warning');
  });

  it('info() creates info toast', () => {
    service.info('FYI');
    expect(service.toasts()[0].type).toBe('info');
  });

  it('can have multiple toasts simultaneously', () => {
    service.show({ message: 'First' });
    service.show({ message: 'Second' });
    expect(service.toasts().length).toBe(2);
  });

  it('does not auto-dismiss when duration is 0', () => {
    service.show({ message: 'Persistent', duration: 0 });
    jasmine.clock().tick(100000);
    expect(service.toasts().length).toBe(1);
  });
});
