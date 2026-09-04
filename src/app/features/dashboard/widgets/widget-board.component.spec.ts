import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { dynamicComponent } from '@/app/shared/dynamic';
import { host, requireEl } from '@/testing';
import { SAMPLE_WIDGETS } from './sample-widgets';
import type { WidgetDefinition } from './widget.contracts';
import { DASHBOARD_WIDGETS, provideDashboardWidgets } from './widget.contracts';
import { WidgetBoardComponent } from './widget-board.component';

describe('WidgetBoardComponent', () => {
  let fixture: ComponentFixture<WidgetBoardComponent>;

  const render = (widgets: readonly WidgetDefinition[]): void => {
    TestBed.configureTestingModule({
      providers: [provideDashboardWidgets(...widgets)],
    });
    fixture = TestBed.createComponent(WidgetBoardComponent);
    fixture.detectChanges();
  };

  const rangeButton = (label: string): HTMLButtonElement => {
    const buttons = Array.from(host(fixture).querySelectorAll('button'));
    const match = buttons.find((b) => b.textContent?.trim() === label);
    if (match === undefined) throw new Error(`No range button labelled "${label}".`);
    return match;
  };

  describe('with the sample widgets', () => {
    beforeEach(() => render(SAMPLE_WIDGETS));

    it('renders one component per registered widget', () => {
      expect(host(fixture).querySelectorAll('app-stat-widget').length).toBe(2);
      expect(host(fixture).querySelectorAll('app-activity-widget').length).toBe(1);
    });

    it('defaults to the 30-day window', () => {
      expect(rangeButton('30 days').getAttribute('aria-pressed')).toBe('true');
      expect(host(fixture).textContent).toContain('$74,310.00');
    });

    it('re-evaluates every bound input when the range changes', () => {
      rangeButton('7 days').click();
      fixture.detectChanges();

      expect(host(fixture).textContent).toContain('$18,420.00');
      expect(host(fixture).textContent).toContain('96');
      // The activity widget's limit is bound as a string on the 7-day window; the
      // transform is what turns it into three rows.
      expect(host(fixture).querySelectorAll('app-activity-widget li').length).toBe(3);

      rangeButton('90 days').click();
      fixture.detectChanges();

      expect(host(fixture).textContent).toContain('$221,905.00');
      expect(host(fixture).querySelectorAll('app-activity-widget li').length).toBe(6);
    });

    it('keeps each widget instance across a range change', () => {
      const before = host(fixture).querySelector('app-stat-widget');
      rangeButton('7 days').click();
      fixture.detectChanges();

      // Same DOM node, so the same component: the range reaches the widget through its
      // bindings rather than by re-rendering it.
      expect(host(fixture).querySelector('app-stat-widget')).toBe(before);
    });

    it('reports the row a widget says was chosen', () => {
      const feedRow = requireEl<HTMLButtonElement>(host(fixture), 'app-activity-widget li button');
      feedRow.click();
      fixture.detectChanges();

      expect(requireEl(host(fixture), '[data-testid="last-selected"]').textContent).toContain(
        'Recent activity — a1'
      );
    });

    it('collapses from the widget and expands from the board', () => {
      const expandAll = (): HTMLButtonElement => rangeButton('Expand all');
      expect(expandAll().disabled).toBeTrue();

      requireEl<HTMLButtonElement>(host(fixture), 'app-stat-widget header button').click();
      fixture.detectChanges();
      expect(expandAll().disabled).toBeFalse();

      expandAll().click();
      fixture.detectChanges();

      expect(expandAll().disabled).toBeTrue();
      expect(host(fixture).textContent).toContain('$74,310.00');
    });
  });

  it('renders nothing but its controls when no widget is registered', () => {
    render([]);

    expect(host(fixture).querySelectorAll('app-stat-widget').length).toBe(0);
    expect(host(fixture).textContent).toContain('Choose a row to open its breakdown.');
  });

  it('is closed over the widgets it renders', () => {
    @Component({
      selector: 'test-extra-widget',
      standalone: true,
      changeDetection: ChangeDetectionStrategy.OnPush,
      template: `<p>{{ caption() }}</p>`,
    })
    class ExtraWidgetComponent {
      readonly caption = input.required<string>();
    }

    // A widget the board has never heard of, added the only way widgets are added.
    render([
      {
        id: 'extra',
        title: 'Extra',
        render: () =>
          dynamicComponent(ExtraWidgetComponent, (bind) => [
            bind.input('caption', () => 'registered late'),
          ]),
      },
    ]);

    expect(host(fixture).textContent).toContain('registered late');
  });

  it('binds DASHBOARD_WIDGETS in the order given', () => {
    render(SAMPLE_WIDGETS);
    expect(TestBed.inject(DASHBOARD_WIDGETS).map((w) => w.id)).toEqual([
      'revenue',
      'signups',
      'activity',
    ]);
  });
});
