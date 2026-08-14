import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { MemberRole, type WorkspaceDto, type WorkspaceMemberDto } from '@kurultay/shared-types';
import messages from '@/messages/en.json';
import { api } from '@/lib/api';
import { WorkspaceProvider, useWorkspaceContext } from './workspace-provider';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn() },
}));

vi.mock('@/lib/socket', () => ({
  disconnectSocket: vi.fn(),
}));

// Both hooks hand back the same object on every render, as the real ones do: the provider
// treats the session and the router as effect dependencies, so a fresh literal per render
// would refetch forever and the test would be measuring its own mock.
vi.mock('next/navigation', () => {
  const router = { replace: vi.fn(), refresh: vi.fn() };
  return {
    useRouter: () => router,
    usePathname: () => '/boards',
  };
});

vi.mock('@/lib/auth', () => {
  const session = {
    data: { session: { activeOrganizationId: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00' } },
    isPending: false,
  };
  return {
    authClient: {
      useSession: () => session,
      organization: { setActive: vi.fn() },
      signOut: vi.fn(),
    },
  };
});

const apiGet = vi.mocked(api.get);

const workspace: WorkspaceDto = {
  id: WORKSPACE_ID,
  name: 'Kurultay',
  slug: 'kurultay',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const membership: WorkspaceMemberDto = {
  id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d01',
  workspaceId: WORKSPACE_ID,
  userId: 'user-1',
  role: MemberRole.ADMIN,
  name: 'Doğan',
  avatarUrl: null,
};

function renderProvider() {
  return renderHook(() => useWorkspaceContext(), {
    wrapper: ({ children }) => (
      <NextIntlClientProvider locale="en" messages={messages}>
        <WorkspaceProvider>{children}</WorkspaceProvider>
      </NextIntlClientProvider>
    ),
  });
}

beforeEach(() => {
  apiGet.mockReset();
});

describe('WorkspaceProvider bootstrap', () => {
  /**
   * The shell wants one fact — this user's role — and used to buy it with `/me` plus the
   * entire roster, which is what made the roster's row cap load-bearing.
   */
  it('reads the role from its own membership without listing members', async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === '/workspaces') return Promise.resolve([workspace]) as never;
      if (path === `/workspaces/${WORKSPACE_ID}/members/me`) {
        return Promise.resolve(membership) as never;
      }
      throw new Error(`unexpected request: ${path}`);
    });

    const { result } = renderProvider();

    await waitFor(() => expect(result.current.bootstrapped).toBe(true));
    expect(result.current.activeRole).toBe(MemberRole.ADMIN);

    const paths = apiGet.mock.calls.map((call) => call[0]);
    expect(paths).toEqual(['/workspaces', `/workspaces/${WORKSPACE_ID}/members/me`]);
  });

  it('leaves the role unset when the membership read fails', async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === '/workspaces') return Promise.resolve([workspace]) as never;
      return Promise.reject(new Error('network')) as never;
    });

    const { result } = renderProvider();

    await waitFor(() => expect(result.current.bootstrapped).toBe(true));
    expect(result.current.activeRole).toBeNull();
    expect(result.current.loadError).not.toBeNull();
  });

  /**
   * The roster decides the active workspace and the active workspace decides whose membership
   * to read, so the two land together — a sign-out mid-sequence must not leave the shell with
   * a workspace list and somebody else's role.
   */
  it('aborts the whole sequence on unmount', async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === '/workspaces') return Promise.resolve([workspace]) as never;
      return new Promise(() => {}) as never;
    });

    const { unmount } = renderProvider();

    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    const signal = (apiGet.mock.calls[0]?.[1] as { signal: AbortSignal }).signal;
    expect(signal.aborted).toBe(false);

    unmount();

    expect(signal.aborted).toBe(true);
  });

  it('retries the bootstrap from the start', async () => {
    apiGet
      .mockImplementationOnce(() => Promise.reject(new Error('network')) as never)
      .mockImplementation((path: string) => {
        if (path === '/workspaces') return Promise.resolve([workspace]) as never;
        return Promise.resolve(membership) as never;
      });

    const { result } = renderProvider();
    await waitFor(() => expect(result.current.loadError).not.toBeNull());

    act(() => result.current.retryBootstrap());

    await waitFor(() => expect(result.current.activeRole).toBe(MemberRole.ADMIN));
    expect(result.current.loadError).toBeNull();
    expect(result.current.workspaces).toHaveLength(1);
  });

  it('keeps the workspace list when switching, and re-reads only the role', async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === '/workspaces') return Promise.resolve([workspace]) as never;
      return Promise.resolve({ ...membership, role: MemberRole.MEMBER }) as never;
    });

    const { result } = renderProvider();
    await waitFor(() => expect(result.current.bootstrapped).toBe(true));

    await act(async () => {
      await result.current.onSwitch(WORKSPACE_ID);
    });

    expect(result.current.activeId).toBe(WORKSPACE_ID);
    expect(result.current.activeRole).toBe(MemberRole.MEMBER);
    expect(result.current.workspaces).toHaveLength(1);
  });

  /**
   * FE-07: `onSwitch` used to write whichever `fetchOwnMembership` reply landed last in wall
   * time, not whichever switch was last *requested*. Two rapid switches with the first's
   * reply arriving after the second's must leave the second switch's role standing — a stale
   * ADMIN reply must not overwrite a just-applied VIEWER role (or vice versa).
   */
  it('drops a stale membership reply from an overtaken switch', async () => {
    const WORKSPACE_B = 'workspace-b';
    const WORKSPACE_C = 'workspace-c';
    let resolveB: ((value: WorkspaceMemberDto) => void) | undefined;
    const bMembership: WorkspaceMemberDto = {
      ...membership,
      workspaceId: WORKSPACE_B,
      role: MemberRole.ADMIN,
    };
    const cMembership: WorkspaceMemberDto = {
      ...membership,
      workspaceId: WORKSPACE_C,
      role: MemberRole.MEMBER,
    };

    apiGet.mockImplementation((path: string) => {
      if (path === '/workspaces') return Promise.resolve([workspace]) as never;
      if (path === `/workspaces/${WORKSPACE_ID}/members/me`) {
        return Promise.resolve(membership) as never;
      }
      // B is the switch that is overtaken: its reply is held open here and only released
      // once C — the switch that actually wins — has already landed.
      if (path === `/workspaces/${WORKSPACE_B}/members/me`) {
        return new Promise<WorkspaceMemberDto>((resolve) => {
          resolveB = resolve;
        }) as never;
      }
      if (path === `/workspaces/${WORKSPACE_C}/members/me`) {
        return Promise.resolve(cMembership) as never;
      }
      throw new Error(`unexpected request: ${path}`);
    });

    const { result } = renderProvider();
    await waitFor(() => expect(result.current.bootstrapped).toBe(true));

    // Fired back-to-back without awaiting the first, exactly the race FE-07 describes: B's
    // `fetchOwnMembership` is still in flight when the switch to C starts, then finishes.
    const switchB = result.current.onSwitch(WORKSPACE_B);
    await act(async () => {
      await result.current.onSwitch(WORKSPACE_C);
    });

    expect(result.current.activeId).toBe(WORKSPACE_C);
    expect(result.current.activeRole).toBe(MemberRole.MEMBER);

    // B's reply lands last in wall time. Without the generation guard this would overwrite
    // `activeRole` with B's ADMIN role even though the shell has already moved on to C.
    await act(async () => {
      resolveB?.(bMembership);
      await switchB;
    });

    expect(result.current.activeId).toBe(WORKSPACE_C);
    expect(result.current.activeRole).toBe(MemberRole.MEMBER);
  });

  /**
   * `RenameWorkspaceDialog` hands the `PATCH` response straight to this — no second fetch — so
   * `WorkspaceSwitcher` (which reads the same `workspaces` array) shows the new name without a
   * full bootstrap. The other workspace stays untouched, matched by id rather than position.
   */
  it('folds a rename into the matching workspace by id, and only that one', async () => {
    const other: WorkspaceDto = { ...workspace, id: 'other-workspace', name: 'Bugs' };
    apiGet.mockImplementation((path: string) => {
      if (path === '/workspaces') return Promise.resolve([workspace, other]) as never;
      return Promise.resolve(membership) as never;
    });

    const { result } = renderProvider();
    await waitFor(() => expect(result.current.bootstrapped).toBe(true));

    act(() => {
      result.current.renameActiveWorkspace({ ...workspace, name: 'Kurultay Labs' });
    });

    expect(result.current.workspaces).toEqual([{ ...workspace, name: 'Kurultay Labs' }, other]);
  });
});
