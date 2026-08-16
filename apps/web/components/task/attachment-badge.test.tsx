import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';
import { AttachmentBadge } from './attachment-badge';

function renderBadge(count: number) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AttachmentBadge count={count} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe('AttachmentBadge', () => {
  it('renders nothing when the task has no attachments', () => {
    const { container } = renderBadge(0);

    // Zero nodes rather than one hidden one: this mounts once per card on the board P2-8 spent
    // a task making cheap, and no attachment is the common case.
    expect(container.innerHTML).toBe('');
  });

  it('renders the count with a label for assistive tech, not a bare digit', () => {
    renderBadge(3);

    expect(screen.getByLabelText('3 attachments')).toBeDefined();
    expect(screen.getByText('3')).toBeDefined();
  });

  it('says "attachment" rather than "attachments" for a single one', () => {
    renderBadge(1);

    expect(screen.getByLabelText('1 attachment')).toBeDefined();
  });
});
