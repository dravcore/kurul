import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CommentBody } from './comment-body';

afterEach(() => {
  cleanup();
});

describe('CommentBody', () => {
  it('renders the body at the read step, not the board’s body step', () => {
    render(<CommentBody body="Looks good, thanks for the fix." />);

    const paragraph = screen.getByText('Looks good, thanks for the fix.').closest('p');
    expect(paragraph?.className).toContain('text-read');
    expect(paragraph?.className).not.toContain('text-body');
  });
});
