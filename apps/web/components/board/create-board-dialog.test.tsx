import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ColumnCategory, LabelColorSlot } from '@kurul/shared-types';
import type { BoardDto, BoardTemplateDto } from '@kurul/shared-types';
import messages from '@/messages/en.json';
import { api } from '@/lib/api';
import { CreateBoardDialog } from './create-board-dialog';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const apiGet = vi.mocked(api.get);
const apiPost = vi.mocked(api.post);

/**
 * Two entries, both shaped like the real thing, and neither one named in the component under
 * test. The point of the picker is that the web does not know the catalog, so the test that
 * proves it must not know it either — swap these for anything and every assertion still holds.
 */
const templates: BoardTemplateDto[] = [
  {
    slug: 'kanban',
    name: 'Kanban',
    description: 'One flow, three stages.',
    columns: [
      { name: 'To Do', position: 1000, category: ColumnCategory.UNSTARTED },
      { name: 'In Progress', position: 2000, category: ColumnCategory.STARTED },
      { name: 'Done', position: 3000, category: ColumnCategory.COMPLETED },
    ],
    labels: [
      { name: 'Bug', color: LabelColorSlot['slot-1'] },
      { name: 'Feature', color: LabelColorSlot['slot-2'] },
    ],
  },
  {
    slug: 'bug-triage',
    name: 'Bug Triage',
    description: 'Incoming reports through fixing and verification.',
    columns: [
      { name: 'Reported', position: 1000, category: ColumnCategory.BACKLOG },
      { name: 'Closed', position: 2000, category: ColumnCategory.COMPLETED },
    ],
    labels: [{ name: 'Critical', color: LabelColorSlot['slot-1'] }],
  },
];

const created = {
  id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d10',
  workspaceId: WORKSPACE_ID,
  name: 'Roadmap',
  description: null,
  createdAt: '2026-01-01T00:00:00.000Z',
} satisfies BoardDto;

beforeAll(() => {
  // Radix Dialog measures and focus-traps its content; jsdom ships neither.
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  Element.prototype.scrollIntoView ??= vi.fn();
});

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  apiGet.mockResolvedValue(templates as never);
  apiPost.mockResolvedValue(created as never);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderDialog(open = true) {
  const onCreated = vi.fn();
  const onOpenChange = vi.fn();
  const view = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CreateBoardDialog
        open={open}
        onOpenChange={onOpenChange}
        workspaceId={WORKSPACE_ID}
        onCreated={onCreated}
      />
    </NextIntlClientProvider>,
  );

  const rerender = (next: boolean): void => {
    view.rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <CreateBoardDialog
          open={next}
          onOpenChange={onOpenChange}
          workspaceId={WORKSPACE_ID}
          onCreated={onCreated}
        />
      </NextIntlClientProvider>,
    );
  };

  return { onCreated, onOpenChange, rerender };
}

const nameField = (): HTMLInputElement => screen.getByLabelText('Name') as HTMLInputElement;
const createButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: 'Create board' }) as HTMLButtonElement;
const radio = (name: string): HTMLInputElement =>
  screen.getByRole('radio', { name: new RegExp(name) }) as HTMLInputElement;
const changeTemplateButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: 'Change template' }) as HTMLButtonElement;

/** Opens the disclosure and waits for the card list it reveals. */
async function expandTemplates(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: 'Change template' }));
  await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(2));
}

describe('CreateBoardDialog', () => {
  it('opens on name, description and a single-line disclosure, the template list hidden', async () => {
    renderDialog();

    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(changeTemplateButton().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  it('creates a board on the catalog default with the picker left collapsed', async () => {
    const { onCreated } = renderDialog();

    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    fireEvent.change(nameField(), { target: { value: 'Roadmap' } });
    fireEvent.click(createButton());

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(apiPost).toHaveBeenCalledWith(`/workspaces/${WORKSPACE_ID}/boards`, {
      name: 'Roadmap',
      description: null,
      template: 'kanban',
    });
    expect(onCreated).toHaveBeenCalledWith(created);
  });

  it('reveals one option per template, with its columns and label preset, once expanded', async () => {
    renderDialog();

    await expandTemplates();
    expect(apiGet).toHaveBeenCalledWith(`/workspaces/${WORKSPACE_ID}/board-templates`);
    expect(screen.getByText('To Do → In Progress → Done')).toBeTruthy();
    expect(screen.getByText('Feature')).toBeTruthy();
    expect(screen.getByText('Critical')).toBeTruthy();
    // The disclosure is one-directional: expanding replaces it with the card list.
    expect(screen.queryByRole('button', { name: 'Change template' })).toBeNull();
  });

  it('preselects whatever the API listed first, naming no slug of its own', async () => {
    renderDialog();

    await expandTemplates();
    expect(radio('Kanban').checked).toBe(true);
    expect(radio('Bug Triage').checked).toBe(false);
  });

  /**
   * Selection wears `--signature` and focus wears `--ring`. The two tokens hold the same copper,
   * so while the unlayered `*` rule was repainting both grey nothing distinguished them and the
   * selected card carried the focus token by accident.
   */
  it('moves the signature border to whichever template is selected', async () => {
    renderDialog();
    await expandTemplates();

    const cardOf = (name: string): Set<string> => {
      const label = radio(name).closest('label');
      if (label === null) throw new Error(`${name} has no enclosing label`);
      return new Set(label.className.split(/\s+/).filter(Boolean));
    };

    expect(cardOf('Kanban').has('border-signature')).toBe(true);
    expect(cardOf('Kanban').has('border-ring')).toBe(false);
    expect(cardOf('Bug Triage').has('border-signature')).toBe(false);
    expect(cardOf('Bug Triage').has('border-border')).toBe(true);
    expect(cardOf('Bug Triage').has('hover:border-border-strong')).toBe(true);

    fireEvent.click(radio('Bug Triage'));

    await waitFor(() => expect(cardOf('Bug Triage').has('border-signature')).toBe(true));
    expect(cardOf('Kanban').has('border-signature')).toBe(false);
  });

  /** Focus is the other copper edge; it belongs to every card, selected or not. */
  it('keeps the focus edge on every template card', async () => {
    renderDialog();
    await expandTemplates();

    for (const name of ['Kanban', 'Bug Triage']) {
      const label = radio(name).closest('label');
      expect(label?.className).toContain('focus-within:border-ring');
    }
  });

  it('sends the chosen template with the board', async () => {
    renderDialog();

    await expandTemplates();
    fireEvent.change(nameField(), { target: { value: '  Incoming  ' } });
    fireEvent.click(radio('Bug Triage'));
    fireEvent.click(createButton());

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(apiPost).toHaveBeenCalledWith(`/workspaces/${WORKSPACE_ID}/boards`, {
      name: 'Incoming',
      description: null,
      template: 'bug-triage',
    });
  });

  it('creates a board with no template at all when the catalog fails to load', async () => {
    apiGet.mockRejectedValue(new Error('offline'));
    const { onCreated } = renderDialog();

    await waitFor(() =>
      expect(
        screen.getByText(
          "Templates couldn't load. This board will start with the default columns.",
        ),
      ).toBeTruthy(),
    );

    fireEvent.change(nameField(), { target: { value: 'Plain' } });
    fireEvent.click(createButton());

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    // No `template` key, not `template: null` — the server reads an absent field as "the
    // default columns and no labels", which is the only outcome that still gives this user a
    // usable board.
    expect(apiPost).toHaveBeenCalledWith(`/workspaces/${WORKSPACE_ID}/boards`, {
      name: 'Plain',
      description: null,
    });
    expect(onCreated).toHaveBeenCalledWith(created);
  });

  it('reopens collapsed, on the catalog’s default rather than on the last choice', async () => {
    const { rerender } = renderDialog();

    await expandTemplates();
    fireEvent.change(nameField(), { target: { value: 'First' } });
    fireEvent.click(radio('Bug Triage'));
    fireEvent.click(createButton());
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));

    rerender(false);
    rerender(true);

    // A fresh mount opens on the disclosure, collapsed, same as the first time.
    await waitFor(() => expect(changeTemplateButton().getAttribute('aria-expanded')).toBe('false'));
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(nameField().value).toBe('');

    // The next board is a new decision. Inheriting the last one would quietly seed a triage
    // board for someone who opened the dialog to make an ordinary one.
    fireEvent.change(nameField(), { target: { value: 'Second' } });
    fireEvent.click(createButton());

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));
    expect(apiPost).toHaveBeenLastCalledWith(`/workspaces/${WORKSPACE_ID}/boards`, {
      name: 'Second',
      description: null,
      template: 'kanban',
    });
  });

  it('refuses to create a board with no name, template or not', async () => {
    renderDialog();

    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    fireEvent.change(nameField(), { target: { value: '   ' } });

    expect(createButton().disabled).toBe(true);
  });
});
