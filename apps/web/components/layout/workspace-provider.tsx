'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { WorkspaceDto } from '@kurultay/shared-types';
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth';

interface WorkspaceContextValue {
  workspaces: WorkspaceDto[];
  activeId: string;
  bootstrapped: boolean;
  loadError: string | null;
  sessionPending: boolean;
  hasSession: boolean;
  retryBootstrap: () => void;
  onSwitch: (workspaceId: string) => Promise<void>;
  onSignOut: () => Promise<void>;
}

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
  const [workspaces, setWorkspaces] = useState<WorkspaceDto[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [bootstrapped, setBootstrapped] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const retryBootstrap = useCallback((): void => {
    setBootstrapped(false);
    setLoadError(null);
    setReloadKey((key) => key + 1);
  }, []);

  useEffect(() => {
    if (isPending) {
      return;
    }
    if (!session) {
      router.replace('/login');
      return;
    }

    const controller = new AbortController();

    void (async () => {
      try {
        const list = await api.get<WorkspaceDto[]>('/workspaces', {
          signal: controller.signal,
        });
        if (controller.signal.aborted) {
          return;
        }

        setWorkspaces(list);
        setLoadError(null);

        if (list.length === 0) {
          setBootstrapped(true);
          if (pathname !== '/workspaces/new') {
            router.replace('/workspaces/new');
          }
          return;
        }

        const activeOrgId = session.session.activeOrganizationId ?? list[0]?.id ?? '';
        setActiveId(activeOrgId);
        if (activeOrgId && activeOrgId !== session.session.activeOrganizationId) {
          await authClient.organization.setActive({ organizationId: activeOrgId });
        }
        setBootstrapped(true);
      } catch {
        if (controller.signal.aborted) {
          return;
        }
        setLoadError(t('shell.loadError'));
        setBootstrapped(true);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [session, isPending, router, reloadKey, t]);

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
      setActiveId(workspaceId);
      await authClient.organization.setActive({ organizationId: workspaceId });
      router.refresh();
    },
    [router],
  );

  const onSignOut = useCallback(async (): Promise<void> => {
    await authClient.signOut();
    router.replace('/login');
    router.refresh();
  }, [router]);

  const value = useMemo(
    (): WorkspaceContextValue => ({
      workspaces,
      activeId,
      bootstrapped,
      loadError,
      sessionPending: isPending,
      hasSession: Boolean(session),
      retryBootstrap,
      onSwitch,
      onSignOut,
    }),
    [
      workspaces,
      activeId,
      bootstrapped,
      loadError,
      isPending,
      session,
      retryBootstrap,
      onSwitch,
      onSignOut,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
