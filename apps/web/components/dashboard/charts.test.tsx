import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { Priority } from '@kurul/shared-types';
import messages from '@/messages/en.json';
import { AssigneeChart } from './assignee-chart';
import { ColumnChart } from './column-chart';
import { CompletionChart } from './completion-chart';
import { PriorityChart } from './priority-chart';

/**
 * The four dashboard charts had no test at all. `dashboard/page.test.tsx` stubs
 * `DashboardSummary`, and `DashboardSummary` pulls every chart in through `next/dynamic`, so
 * nothing in the suite ever mounted Recharts — a major Recharts bump could stop a series
 * drawing and the whole suite would stay green. These tests mount the real components
 * against the real library and assert on the painted SVG.
 */

const CHART_WIDTH = 640;
// Matches the `h-56` box `ChartTableToggle` puts the chart in.
const CHART_HEIGHT = 224;

/**
 * Recharts measures itself from the DOM, and jsdom reports every element as 0x0 with no
 * ResizeObserver — an unsized chart renders an empty shell and every assertion below would
 * pass vacuously.
 *
 * Only the responsive container is given a box. Sizing *every* element instead (e.g. a blanket
 * `getBoundingClientRect` stub) makes the legend measure as tall as the chart, which pushes the
 * plot area to zero height and silently drops the series — the exact false failure this
 * comment exists to stop the next person from re-introducing.
 */
beforeAll(() => {
  globalThis.ResizeObserver = class {
    private readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element): void {
      this.callback(
        [
          {
            target,
            contentRect: { width: CHART_WIDTH, height: CHART_HEIGHT },
          } as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver,
      );
    }
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;

  for (const [prop, size] of [
    ['offsetWidth', CHART_WIDTH],
    ['clientWidth', CHART_WIDTH],
    ['offsetHeight', CHART_HEIGHT],
    ['clientHeight', CHART_HEIGHT],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get(this: HTMLElement): number {
        return this.classList?.contains('recharts-responsive-container') ? size : 0;
      },
    });
  }
});

afterEach(() => {
  cleanup();
});

function renderChart(ui: React.ReactElement): HTMLElement {
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
  return container;
}

/** Axis tick labels in paint order, e.g. the category names down a vertical bar chart. */
function tickLabels(container: HTMLElement, axis: 'xAxis' | 'yAxis'): string[] {
  return [...container.querySelectorAll(`.recharts-${axis}-tick-labels text`)]
    .map((node) => node.textContent ?? '')
    .filter(Boolean);
}

/** Upper bound for the bar animation to finish; polling stops as soon as the bars appear. */
const BAR_ANIMATION_TIMEOUT_MS = 10_000;

/**
 * Test-level timeout for the two `it()`s that call {@link barPaths}, comfortably above
 * `BAR_ANIMATION_TIMEOUT_MS` itself.
 *
 * This is the fix for issue #244 ("load-sensitive"). `barPaths` promises to poll for up to
 * `BAR_ANIMATION_TIMEOUT_MS`, but Vitest's own default per-test timeout is 5000ms — shorter
 * than that promise. Under normal load the animation always finishes well inside 5s, so the
 * mismatch was invisible; under concurrent load (confirmed by running this file alongside
 * `apps/api`'s Jest suite, matching the two sightings in #244) `requestAnimationFrame`
 * callbacks are delayed enough that Vitest's timeout fires *first*, aborting the test in the
 * middle of an `act()` call. That abort is what produced every symptom in #244: not just the
 * one bar-painting assertion timing out, but every other test in the file failing too — an
 * `act()` killed mid-flight leaves React's environment in the "overlapping act() calls" state
 * the aborted run logs, and every subsequent render in the same file inherits it. Giving these
 * two tests a timeout Vitest will not pre-empt before `barPaths`'s own deadline can be reached
 * removes the abort, not just the symptom.
 */
const BAR_ANIMATION_TEST_TIMEOUT_MS = BAR_ANIMATION_TIMEOUT_MS + 5_000;

/**
 * Bars animate in and are absent from the first paint, so the shapes only exist once the
 * animation has run — asserting before that would test the scaffolding, not the drawn chart.
 *
 * Each step is a real timer advanced inside `act` rather than a `waitFor`: the animation is
 * driven by `requestAnimationFrame`, and `waitFor`'s own polling never lets those frames
 * commit, so the bars stay missing until it times out. Polling (rather than one fixed sleep)
 * keeps this from going flaky when the whole suite runs in parallel and frames are delayed.
 */
async function barPaths(container: HTMLElement): Promise<SVGPathElement[]> {
  const deadline = Date.now() + BAR_ANIMATION_TIMEOUT_MS;

  for (;;) {
    const paths = [...container.querySelectorAll<SVGPathElement>('.recharts-bar-rectangle path')];
    if (paths.length > 0) return paths;
    if (Date.now() > deadline) {
      throw new Error(
        `No bar shapes were painted within ${BAR_ANIMATION_TIMEOUT_MS}ms — the chart rendered its axes but never drew the series.`,
      );
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  }
}

describe('PriorityChart', () => {
  const data = [
    { priority: Priority.LOW, count: 3 },
    { priority: Priority.MEDIUM, count: 7 },
    { priority: Priority.HIGH, count: 2 },
    { priority: Priority.URGENT, count: 1 },
  ];

  it(
    'paints one bar per priority, coloured by its own token',
    async () => {
      const container = renderChart(<PriorityChart data={data} />);

      const paths = await barPaths(container);

      // `<Cell>` is what makes the four bars four different colours; without it the chart
      // renders as one flat series colour.
      expect(paths.map((path) => path.getAttribute('fill'))).toEqual([
        'var(--priority-low)',
        'var(--priority-medium)',
        'var(--priority-high)',
        'var(--priority-urgent)',
      ]);
      // A bar with no geometry is a bar nobody can see.
      for (const path of paths) {
        expect(path.getAttribute('d')).toBeTruthy();
      }
    },
    BAR_ANIMATION_TEST_TIMEOUT_MS,
  );

  it('labels the category axis with translated priority names', () => {
    const container = renderChart(<PriorityChart data={data} />);

    expect(tickLabels(container, 'yAxis')).toEqual(['Low', 'Medium', 'High', 'Urgent']);
  });

  it('swaps the SVG for a table when the toggle is used', () => {
    const container = renderChart(<PriorityChart data={data} />);

    fireEvent.click(screen.getByRole('button', { name: 'View as table' }));

    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByRole('table')).toBeTruthy();
  });
});

describe('AssigneeChart', () => {
  it(
    'paints a bar per assignee and translates the synthetic buckets',
    async () => {
      const container = renderChart(
        <AssigneeChart
          data={[
            { userId: 'u1', name: 'Ada', count: 5 },
            { userId: null, name: 'Unassigned', count: 2 },
            { userId: null, name: 'Other', count: 1 },
          ]}
        />,
      );

      expect(await barPaths(container)).toHaveLength(3);
      // 'Unassigned'/'Other' are sentinels from the API, not real names, and must be localised.
      expect(tickLabels(container, 'yAxis')).toEqual(['Ada', 'Unassigned', 'Other']);
    },
    BAR_ANIMATION_TEST_TIMEOUT_MS,
  );

  it('renders an empty chart rather than throwing when there is no data', () => {
    const container = renderChart(<AssigneeChart data={[]} />);

    expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(0);
    expect(container.querySelector('svg')).toBeTruthy();
  });
});

describe('ColumnChart', () => {
  it('orders the axis by column position, not by the order received', () => {
    const container = renderChart(
      <ColumnChart
        data={[
          { columnId: 'c3', name: 'Done', position: 3, count: 4 },
          { columnId: 'c1', name: 'Todo', position: 1, count: 9 },
          { columnId: 'c2', name: 'Doing', position: 2, count: 2 },
        ]}
      />,
    );

    expect(tickLabels(container, 'yAxis')).toEqual(['Todo', 'Doing', 'Done']);
  });
});

describe('CompletionChart', () => {
  const throughput = [
    { date: '2026-08-10', created: 4, completed: 2 },
    { date: '2026-08-11', created: 1, completed: 5 },
    { date: '2026-08-12', created: 3, completed: 3 },
  ];

  it('draws both series as separate curves', () => {
    const container = renderChart(<CompletionChart data={throughput} />);

    const curves = container.querySelectorAll('.recharts-line-curve');
    expect(curves).toHaveLength(2);
    // A curve with no `d` drew nothing.
    for (const curve of curves) {
      expect(curve.getAttribute('d')).toBeTruthy();
    }
  });

  it('names both series in the legend', () => {
    renderChart(<CompletionChart data={throughput} />);

    expect(screen.getByText('Created')).toBeTruthy();
    expect(screen.getByText('Completed')).toBeTruthy();
  });

  it('shortens the x-axis label to MM-DD', () => {
    const container = renderChart(<CompletionChart data={throughput} />);

    expect(tickLabels(container, 'xAxis')).toEqual(['08-10', '08-11', '08-12']);
  });

  it('renders without throwing when the throughput window is empty', () => {
    const container = renderChart(<CompletionChart data={[]} />);

    expect(container.querySelectorAll('.recharts-line-curve')).toHaveLength(0);
    expect(container.querySelector('svg')).toBeTruthy();
  });
});
