'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useWorkspaceContext } from '@/components/layout/workspace-provider';
import { useNotificationSocket } from './use-notification-socket';
import { useNotificationUnread, type NotificationUnread } from './use-notification-unread';

export interface NotificationUnreadContextValue extends NotificationUnread {
  /**
   * Bumped whenever the socket says the count moved.
   *
   * One signal, several readers. The count above is already refreshed by it; a surface that
   * renders rows of its own (the bell's dropdown) reads this to know its rows are stale.
   */
  refreshKey: number;
}

const NotificationUnreadContext = createContext<NotificationUnreadContextValue | null>(null);

export function useNotificationUnreadContext(): NotificationUnreadContextValue {
  const value = useContext(NotificationUnreadContext);
  if (!value) {
    throw new Error('useNotificationUnreadContext must be used within NotificationUnreadProvider');
  }
  return value;
}

/**
 * The app's single unread count, with the socket that keeps it honest.
 *
 * Two surfaces show or move the same number: the bell's badge, which renders inside
 * `AppSidebar`, and the notifications page, which renders inside `main`. Neither contains the
 * other, so before this existed the page's "mark all read" could only patch the rows it had
 * loaded and the badge went on showing a count the user had just cleared, until a socket
 * signal or the two-minute fallback poll happened to correct it.
 *
 * The socket lives here rather than in the bell for the same reason the count does: the room
 * feeds the badge, and one subscription per shell is what keeps a (re)join from being emitted
 * twice for the same room. The notifications page keeps its own subscription because it reacts
 * to a different thing (its rows), and `use-notification-socket.ts` ref-counts the room so the
 * two holders cannot leave it out from under each other.
 */
export function NotificationUnreadProvider({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): React.ReactElement {
  const { activeId: workspaceId, bootstrapped } = useWorkspaceContext();

  const [refreshKey, setRefreshKey] = useState(0);
  const refreshOpenViews = useCallback((): void => {
    setRefreshKey((key) => key + 1);
  }, []);

  const { connected } = useNotificationSocket(workspaceId, bootstrapped, {
    onUnreadChanged: refreshOpenViews,
    // A (re)join replays nothing, so the first thing after it is a full refresh: that is what
    // closes the gap a disconnection opened.
    onResync: refreshOpenViews,
  });

  const { count, setCount } = useNotificationUnread({
    workspaceId,
    enabled: bootstrapped,
    connected,
    refreshKey,
  });

  const value = useMemo(
    (): NotificationUnreadContextValue => ({ count, setCount, refreshKey }),
    [count, setCount, refreshKey],
  );

  return (
    <NotificationUnreadContext.Provider value={value}>
      {children}
    </NotificationUnreadContext.Provider>
  );
}
