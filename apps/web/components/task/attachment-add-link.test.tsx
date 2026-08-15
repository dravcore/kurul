import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';
import { AttachmentAddLink } from './attachment-add-link';

function renderForm(onAddLink = vi.fn().mockResolvedValue(true)) {
  const view = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AttachmentAddLink onAddLink={onAddLink} />
    </NextIntlClientProvider>,
  );
  return { ...view, onAddLink };
}

function open(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Attach a link' }));
}

afterEach(() => {
  cleanup();
});

describe('AttachmentAddLink', () => {
  it('stays behind a disclosure until asked for', () => {
    renderForm();

    expect(screen.queryByLabelText('Link URL')).toBeNull();
    open();
    expect(screen.getByLabelText('Link URL')).toBeDefined();
    expect(screen.getByLabelText('Label (optional)')).toBeDefined();
  });

  it('sends the URL and the optional label', async () => {
    const { onAddLink } = renderForm();
    open();

    fireEvent.change(screen.getByLabelText('Link URL'), {
      target: { value: 'https://figma.example/file/1' },
    });
    fireEvent.change(screen.getByLabelText('Label (optional)'), {
      target: { value: 'Design file' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));

    await waitFor(() =>
      expect(onAddLink).toHaveBeenCalledWith('https://figma.example/file/1', 'Design file'),
    );
  });

  it('submits on Enter from either field', async () => {
    const { onAddLink } = renderForm();
    open();

    fireEvent.change(screen.getByLabelText('Link URL'), { target: { value: 'https://a.example' } });
    fireEvent.keyDown(screen.getByLabelText('Label (optional)'), { key: 'Enter' });

    await waitFor(() => expect(onAddLink).toHaveBeenCalledWith('https://a.example', ''));
  });

  it('does not spend a request on a blank URL', () => {
    const { onAddLink } = renderForm();
    open();

    fireEvent.change(screen.getByLabelText('Link URL'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));

    expect(onAddLink).not.toHaveBeenCalled();
  });

  it('does not judge the scheme — that check lives on the server', async () => {
    // K7's allowlist is enforced where it can be enforced. A client-side copy would be a second
    // implementation that reads like the authority it is not, so `javascript:` is sent and
    // refused with a 400 rather than being quietly swallowed here.
    const { onAddLink } = renderForm(vi.fn().mockResolvedValue(false));
    open();

    fireEvent.change(screen.getByLabelText('Link URL'), {
      target: { value: 'javascript:alert(1)' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));

    await waitFor(() => expect(onAddLink).toHaveBeenCalledWith('javascript:alert(1)', ''));
  });

  it('keeps the form and its text when the write is refused', async () => {
    const onAddLink = vi.fn().mockResolvedValue(false);
    renderForm(onAddLink);
    open();

    fireEvent.change(screen.getByLabelText('Link URL'), { target: { value: 'https://a.example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));

    await waitFor(() => expect(onAddLink).toHaveBeenCalled());
    expect((screen.getByLabelText('Link URL') as HTMLInputElement).value).toBe('https://a.example');
  });

  it('closes and empties itself after a successful write', async () => {
    renderForm();
    open();

    fireEvent.change(screen.getByLabelText('Link URL'), { target: { value: 'https://a.example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));

    await waitFor(() => expect(screen.queryByLabelText('Link URL')).toBeNull());

    open();
    expect((screen.getByLabelText('Link URL') as HTMLInputElement).value).toBe('');
  });

  it('can be dismissed without writing anything', () => {
    const { onAddLink } = renderForm();
    open();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByLabelText('Link URL')).toBeNull();
    expect(onAddLink).not.toHaveBeenCalled();
  });
});
