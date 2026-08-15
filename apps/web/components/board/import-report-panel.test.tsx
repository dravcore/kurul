import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { TrelloImportReportDto, TrelloImportSkipGroupDto } from '@kurultay/shared-types';
import messages from '@/messages/en.json';
import { ImportReportPanel } from './import-report-panel';

const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d10';

function report(overrides: Partial<TrelloImportReportDto> = {}): TrelloImportReportDto {
  return {
    boardId: BOARD_ID,
    boardName: 'Product roadmap',
    imported: {
      columns: 8,
      tasks: 124,
      labels: 6,
      checklists: 19,
      checklistItems: 87,
      attachments: 5,
    },
    skipped: [],
    ...overrides,
  };
}

function group(overrides: Partial<TrelloImportSkipGroupDto> = {}): TrelloImportSkipGroupDto {
  return { scope: 'comment', reason: 'outOfScope', count: 31, samples: [], ...overrides };
}

function renderPanel(value: TrelloImportReportDto, onDismiss = vi.fn()): { onDismiss: () => void } {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ImportReportPanel report={value} onDismiss={onDismiss} />
    </NextIntlClientProvider>,
  );
  return { onDismiss };
}

function panel(): HTMLElement {
  return screen.getByRole('region', { name: /import report/i });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ImportReportPanel', () => {
  it('shows what was written, one count per kind of row', () => {
    renderPanel(report());

    const region = panel();
    expect(within(region).getByText('124 tasks')).toBeDefined();
    expect(within(region).getByText('8 columns')).toBeDefined();
    expect(within(region).getByText('87 checklist items')).toBeDefined();
    expect(within(region).getByText('5 attachment links')).toBeDefined();
  });

  it('names each skipped group with the real count and says why', () => {
    renderPanel(
      report({
        skipped: [
          group({ scope: 'comment', reason: 'outOfScope', count: 31 }),
          group({ scope: 'card', reason: 'archived', count: 2000 }),
          group({ scope: 'column', reason: 'defaulted', count: 8 }),
        ],
      }),
    );

    const region = panel();
    expect(within(region).getByText(/31 comments were not imported/i)).toBeDefined();
    expect(within(region).getByText(/2,000 cards were not imported/i)).toBeDefined();
    expect(within(region).getByText(/8 columns came across changed/i)).toBeDefined();
  });

  /**
   * The claim this file exists for. `count` is the real number and the API never caps it;
   * `samples` stops at 20. A panel that counted the samples would report "20 cards" about an
   * import that dropped 143, using numbers it was handed correctly.
   */
  it('counts with `count`, not with the number of samples it was sent', () => {
    const samples = Array.from({ length: 20 }, (_, index) => `Card ${index + 1}`);
    renderPanel(
      report({ skipped: [group({ scope: 'card', reason: 'malformed', count: 143, samples })] }),
    );

    const region = panel();
    expect(within(region).getByText(/143 cards were not imported/i)).toBeDefined();
    expect(within(region).queryByText(/20 cards were not imported/i)).toBeNull();
  });

  it('says the example list is a truncation rather than the whole of it', () => {
    const samples = Array.from({ length: 20 }, (_, index) => `Card ${index + 1}`);
    renderPanel(
      report({ skipped: [group({ scope: 'card', reason: 'malformed', count: 143, samples })] }),
    );

    const region = panel();
    expect(within(region).getByText('Showing 20 of 143 examples')).toBeDefined();
    expect(within(region).getByText('Card 1')).toBeDefined();
    expect(within(region).getByText('Card 20')).toBeDefined();
  });

  it('still states the ratio when nothing was truncated, so the two numbers are never confused', () => {
    renderPanel(
      report({
        skipped: [group({ scope: 'label', reason: 'defaulted', count: 2, samples: ['a', 'b'] })],
      }),
    );

    expect(within(panel()).getByText('Showing 2 of 2 examples')).toBeDefined();
  });

  it('offers no example list at all when the report carried no samples', () => {
    renderPanel(report({ skipped: [group({ count: 31, samples: [] })] }));

    expect(within(panel()).queryByText(/Showing \d+ of/)).toBeNull();
  });

  it('does not invent a group that is not in the report', () => {
    renderPanel(report({ skipped: [] }));

    const region = panel();
    expect(within(region).queryByText(/were not imported/i)).toBeNull();
    expect(within(region).getByText(messages.app.board.import.nothingSkipped)).toBeDefined();
  });

  /** The report is the only copy there is, so the panel has to say that dismissing ends it. */
  it('says out loud that dismissing the report is permanent', () => {
    renderPanel(report());

    expect(within(panel()).getByText(/cannot be shown again/i)).toBeDefined();
  });

  it('dismisses only when asked', () => {
    const { onDismiss } = renderPanel(report());

    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: messages.app.board.import.dismiss }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('points a defaulted-category group at the board where categories are set', () => {
    renderPanel(report({ skipped: [group({ scope: 'column', reason: 'defaulted', count: 8 })] }));

    const link = screen.getByRole('link', { name: messages.app.board.import.setColumnCategories });
    expect(link.getAttribute('href')).toBe(`/board/${BOARD_ID}`);
  });

  /** Without this the action row could be rendered for every group and the test above still pass. */
  it('does not offer the column action for a group that has no column settings to fix', () => {
    renderPanel(report({ skipped: [group({ scope: 'card', reason: 'archived', count: 3 })] }));

    expect(
      screen.queryByRole('link', { name: messages.app.board.import.setColumnCategories }),
    ).toBeNull();
  });

  it('leads to the board it created', () => {
    renderPanel(report());

    const link = screen.getByRole('link', { name: messages.app.board.import.goToBoard });
    expect(link.getAttribute('href')).toBe(`/board/${BOARD_ID}`);
  });
});
