import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { InlineRename, type InlineRenameField } from './inline-rename';

beforeAll(() => {
  // Radix-free component, but jsdom still lacks `scrollIntoView`, which `SubmitError`'s focus
  // effect and Radix siblings elsewhere in the suite rely on.
  Element.prototype.scrollIntoView ??= vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function nameField(value: string, onChange = vi.fn()): InlineRenameField {
  return { id: 'name', label: 'Name', value, onChange, required: true };
}

function descriptionField(value: string, onChange = vi.fn()): InlineRenameField {
  return { id: 'description', label: 'Description', value, onChange };
}

describe('InlineRename', () => {
  it('opens with the first field selected', () => {
    render(
      <InlineRename
        fields={[nameField('Roadmap')]}
        saveLabel="Save"
        cancelLabel="Cancel"
        onSave={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn()}
        resolveError={() => 'failed'}
      />,
    );

    const input = screen.getByLabelText('Name') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it('saves on Enter in the first field', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <InlineRename
        fields={[nameField('Roadmap')]}
        saveLabel="Save"
        cancelLabel="Cancel"
        onSave={onSave}
        onCancel={vi.fn()}
        resolveError={() => 'failed'}
      />,
    );

    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Enter' });

    await waitFor(() => expect(onSave).toHaveBeenCalled());
  });

  it('saves on Enter in a second field too', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <InlineRename
        fields={[nameField('Roadmap'), descriptionField('Where the quarter lives')]}
        saveLabel="Save"
        cancelLabel="Cancel"
        onSave={onSave}
        onCancel={vi.fn()}
        resolveError={() => 'failed'}
      />,
    );

    fireEvent.keyDown(screen.getByLabelText('Description'), { key: 'Enter' });

    await waitFor(() => expect(onSave).toHaveBeenCalled());
  });

  it('saves when the Save button is clicked, the same as Enter', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <InlineRename
        fields={[nameField('Roadmap')]}
        saveLabel="Save"
        cancelLabel="Cancel"
        onSave={onSave}
        onCancel={vi.fn()}
        resolveError={() => 'failed'}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
  });

  it('cancels on Escape without saving', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();
    render(
      <InlineRename
        fields={[nameField('Roadmap')]}
        saveLabel="Save"
        cancelLabel="Cancel"
        onSave={onSave}
        onCancel={onCancel}
        resolveError={() => 'failed'}
      />,
    );

    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Escape' });

    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('cancels when the Cancel button is clicked, the same as Escape', () => {
    const onCancel = vi.fn();
    render(
      <InlineRename
        fields={[nameField('Roadmap')]}
        saveLabel="Save"
        cancelLabel="Cancel"
        onSave={vi.fn().mockResolvedValue(undefined)}
        onCancel={onCancel}
        resolveError={() => 'failed'}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalled();
  });

  it('treats an Enter save with the required field emptied as a cancel, not a request', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();
    const onChange = vi.fn();
    render(
      <InlineRename
        fields={[nameField('   ', onChange)]}
        saveLabel="Save"
        cancelLabel="Cancel"
        onSave={onSave}
        onCancel={onCancel}
        resolveError={() => 'failed'}
      />,
    );

    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Enter' });

    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('marks the form aria-busy and the fields read-only while the save is in flight', async () => {
    let resolveSave: () => void = () => {};
    const onSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    render(
      <InlineRename
        fields={[nameField('Roadmap')]}
        saveLabel="Save"
        cancelLabel="Cancel"
        onSave={onSave}
        onCancel={vi.fn()}
        resolveError={() => 'failed'}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Name').closest('form')?.getAttribute('aria-busy')).toBe('true');
    });
    const input = screen.getByLabelText('Name') as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(input.disabled).toBe(false);

    resolveSave();
    await waitFor(() => expect(input.readOnly).toBe(false));
  });

  it('shows the resolved error inline without moving focus off the field', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('boom'));
    render(
      <InlineRename
        fields={[nameField('Roadmap')]}
        saveLabel="Save"
        cancelLabel="Cancel"
        onSave={onSave}
        onCancel={vi.fn()}
        resolveError={() => 'Could not rename this.'}
      />,
    );

    const input = screen.getByLabelText('Name');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Could not rename this.',
    );
    expect(document.activeElement).toBe(input);
  });

  it('leaves the editor open and re-enables Save after a failed save', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('boom'));
    render(
      <InlineRename
        fields={[nameField('Roadmap')]}
        saveLabel="Save"
        cancelLabel="Cancel"
        onSave={onSave}
        onCancel={vi.fn()}
        resolveError={() => 'Could not rename this.'}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(false);
  });
});
