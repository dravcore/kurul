import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import messages from '@/messages/en.json';

const INVITATION_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d51';

const mocks = vi.hoisted(() => ({
  inviteAcceptView: vi.fn(),
}));

vi.mock('next-intl/server', () => ({
  getTranslations: (namespace: string) =>
    Promise.resolve(createTranslator({ locale: 'en', messages, namespace })),
}));

vi.mock('@/components/auth/invite-accept-view', () => ({
  InviteAcceptView: (props: { invitationId: string }): React.ReactElement => {
    mocks.inviteAcceptView(props);
    return <div data-testid="invite-accept-view" />;
  },
}));

import InviteAcceptPage from './page';

beforeEach(() => {
  mocks.inviteAcceptView.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('InviteAcceptPage', () => {
  it('passes the invitation id from the URL down to the accept view', async () => {
    render(await InviteAcceptPage({ params: Promise.resolve({ invitationId: INVITATION_ID }) }));

    expect(screen.getByTestId('invite-accept-view')).toBeTruthy();
    expect(mocks.inviteAcceptView).toHaveBeenCalledWith(
      expect.objectContaining({ invitationId: INVITATION_ID }),
    );
  });
});
