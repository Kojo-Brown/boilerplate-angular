import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { host, requireEl } from '@/testing';
import { PanelSkeletonComponent } from './panel-skeleton.component';

describe('PanelSkeletonComponent', () => {
  function create(inputs: { label?: string; rows?: number | string } = {}) {
    TestBed.configureTestingModule({ imports: [PanelSkeletonComponent] });
    const fixture = TestBed.createComponent(PanelSkeletonComponent);
    if (inputs.label !== undefined) fixture.componentRef.setInput('label', inputs.label);
    if (inputs.rows !== undefined) fixture.componentRef.setInput('rows', inputs.rows);
    fixture.detectChanges();
    return fixture;
  }

  function bars(fixture: ComponentFixture<unknown>): HTMLElement[] {
    return Array.from(
      requireEl<HTMLElement>(host(fixture), '[aria-hidden="true"] .space-y-2').children
    ) as HTMLElement[];
  }

  it('draws one bar per row', () => {
    expect(bars(create({ rows: 6 })).length).toBe(6);
  });

  it('accepts a row count written as an attribute string', () => {
    // How every caller writes it: a `@placeholder` block is markup, so `rows="4"` is the
    // natural spelling and `numberAttribute` is what makes it mean 4 rather than "4".
    expect(bars(create({ rows: '4' })).length).toBe(4);
  });

  it('announces what is loading rather than leaving the region unlabelled', () => {
    const fixture = create({ label: 'publishing activity' });

    const status = requireEl<HTMLElement>(host(fixture), '[role="status"]');
    expect(status.textContent).toContain('Loading publishing activity');
  });

  it('hides the bars from assistive technology', () => {
    // Six identical empty boxes are noise in the accessibility tree; the `role="status"`
    // announcement above is what a screen-reader user should get instead.
    const fixture = create({ rows: 6 });

    const shimmer = requireEl<HTMLElement>(host(fixture), '[aria-hidden="true"]');
    expect(shimmer.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders exactly one root element, which is what an implicit @defer trigger needs', () => {
    // `on viewport` and `on interaction` without an explicit reference observe the
    // `@placeholder`'s single root element node, and Angular throws at runtime when there
    // is more than one. This component is written to be that placeholder, so the
    // constraint belongs to it — a wrapper added here would break every host at once, and
    // only in a browser.
    const fixture = create();

    const roots = Array.from(host(fixture).childNodes).filter(
      (node) => node.nodeType === Node.ELEMENT_NODE
    );
    expect(roots.length).toBe(1);
  });
});
