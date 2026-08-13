'use client';

import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { MemberRole, WorkspaceDto } from '@kurultay/shared-types';
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth';
import { fetchOwnMembership } from '@/lib/member-query';
import { disconnectSocket } from '@/lib/socket';
import { useApiResource } from '@/lib/use-api-resource';

interface WorkspaceContextValue {
  workspaces: WorkspaceDto[];
  activeId: string;
  activeRole: MemberRole | null;
  bootstrapped: boolean;
  loadError: string | null;
  sessionPending: boolean;
  hasSession: boolean;
  retryBootstrap: () => void;
  onSwitch: (workspaceId: string) => Promise<void>;
  onSignOut: () => Promise<void>;
  /**
   * Folds a `PATCH /workspaces/:workspaceId` response back into `workspaces` by id.
   *
   * `RenameWorkspaceDialog` already has the updated `WorkspaceDto` in hand — the response body
   * of the call it just made — so this never re-fetches. It exists at all because the name
   * shown in `WorkspaceSwitcher` and the one shown in Settings both read the same `workspaces`
   * array; without this, a rename would be visible on the settings row (which could hold its
   * own local state) but stale in the switcher until the next full bootstrap.
   */
  renameActiveWorkspace: (workspace: WorkspaceDto) => void;
}

/**
 * What one bootstrap answers with. Loaded as a single value because it is a single sequence
 * of requests — the roster decides the active workspace, and the active workspace decides
 * whose membership to read — so a workspace switch mid-flight must land as one write or not
 * at all. Split across three `useState`s it could half-apply and leave the shell showing one
 * workspace's name next to another's role.
 */
interface WorkspaceBootstrap {
  workspaces: WorkspaceDto[];
  activeId: string;
  activeRole: MemberRole | null;
}

const NO_WORKSPACES: WorkspaceBootstrap = { workspaces: [], activeId: '', activeRole: null };

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspaceContext(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) {
    throw new Error('useWorkspaceContext must be used within WorkspaceProvider');
  }
  return value;
}

export function WorkspaceProvider({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): React.ReactElement {
  const t = useTranslations('app');
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, isPending } = authClient.useSession();

  // `null` holds the load off until the session is known — before that there is nothing to
  // scope the request to, and after a sign-out there is nobody to scope it for.
  const bootstrap = useMemo(() => {
    if (isPending || !session) return null;
    return async (signal: AbortSignal): Promise<WorkspaceBootstrap> => {
      const workspaces = await api.get<WorkspaceDto[]>('/workspaces', { signal });
      // The redirect belongs to the effect below, which watches the same state and already
      // reacts to `pathname` — doing it here would tie this load to every navigation.
      if (workspaces.length === 0) return NO_WORKSPACES;

      const activeId = session.session.activeOrganizationId ?? workspaces[0]?.id ?? '';
      if (activeId && activeId !== session.session.activeOrganizationId) {
        await authClient.organization.setActive({ organizationId: activeId });
      }
      if (!activeId) return { workspaces, activeId: '', activeRole: null };

      // The shell needs one thing from the workspace — this user's role — so it asks for
      // exactly that. Reading the whole roster and matching it against `/me` cost two
      // requests to answer a question one row already knows.
      const membership = await fetchOwnMembership(activeId, { signal });
      return { workspaces, activeId, activeRole: membership.role };
    };
  }, [session, isPending]);

  const {
    data: { workspaces, activeId, activeRole },
    loading,
    error: loadError,
    reload: retryBootstrap,
    setData: setBootstrap,
  } = useApiResource<WorkspaceBootstrap>(bootstrap, NO_WORKSPACES, t('shell.loadError'));

  // The shell asks "has the load finished", not "is it running" — including the failed case,
  // which is finished too and shows `loadError` rather than a skeleton.
  const bootstrapped = !loading;

  useEffect(() => {
    if (!isPending && !session) {
      router.replace('/login');
    }
  }, [isPending, session, router]);

  useEffect(() => {
    if (!bootstrapped || loadError || workspaces.length > 0) {
      return;
    }
    if (pathname !== '/workspaces/new') {
      router.replace('/workspaces/new');
    }
  }, [bootstrapped, loadError, workspaces.length, pathname, router]);

  const onSwitch = useCallback(
    async (workspaceId: string): Promise<void> => {
      // Applied before the role is known so the rest of the shell re-scopes immediately; the
      // role follows a moment later rather than holding the whole switch behind one request.
      setBootstrap((current) => ({ ...current, activeId: workspaceId }));
      await authClient.organization.setActive({ organizationId: workspaceId });
      try {
        const membership = await fetchOwnMembership(workspaceId);
        setBootstrap((current) => ({ ...current, activeRole: membership.role }));
      } catch {
        setBootstrap((current) => ({ ...current, activeRole: null }));
      }
      router.refresh();
    },
    [router, setBootstrap],
  );

  const onSignOut = useCallback(async (): Promise<void> => {
    disconnectSocket();
    await authClient.signOut();
    router.replace('/login');
    router.refresh();
  }, [router]);

  const renameActiveWorkspace = useCallback(
    (updated: WorkspaceDto): void => {
      setBootstrap((current) => ({
        ...current,
        workspaces: current.workspaces.map((workspace) =>
          workspace.id === updated.id ? updated : workspace,
        ),
      }));
    },
    [setBootstrap],
  );

  const value = useMemo(
    (): WorkspaceContextValue => ({
      workspaces,
      activeId,
      activeRole,
      bootstrapped,
      loadError,
      sessionPending: isPending,
      hasSession: Boolean(session),
      retryBootstrap,
      onSwitch,
      onSignOut,
      renameActiveWorkspace,
    }),
    [
      workspaces,
      activeId,
      activeRole,
      bootstrapped,
      loadError,
      isPending,
      session,
      retryBootstrap,
      onSwitch,
      onSignOut,
      renameActiveWorkspace,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
