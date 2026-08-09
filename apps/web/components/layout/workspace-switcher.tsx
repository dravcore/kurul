'use client';

import Link from 'next/link';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useWorkspaceContext } from './workspace-provider';

export function WorkspaceSwitcher({
  collapsed,
}: Readonly<{ collapsed: boolean }>): React.ReactElement {
  const t = useTranslations('app.shell');
  const { workspaces, activeId, onSwitch } = useWorkspaceContext();
  const active = workspaces.find((workspace) => workspace.id === activeId);
  const initial = (active?.name ?? '?').charAt(0).toLocaleUpperCase('en-US');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label={t('switchWorkspace')}
          className={cn(
            'h-10 justify-start gap-2 px-2',
            collapsed ? 'w-10 justify-center px-0' : 'w-full',
          )}
        >
          <span
            aria-hidden
            className="flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-signature-subtle text-small font-medium text-signature"
          >
            {initial}
          </span>
          {!collapsed ? (
            <>
              <span className="min-w-0 flex-1 truncate text-left text-body">{active?.name}</span>
              <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
            </>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {workspaces.map((workspace) => (
          <DropdownMenuItem key={workspace.id} onClick={() => void onSwitch(workspace.id)}>
            <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
            {workspace.id === activeId ? <Check /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/workspaces/new">
            <Plus />
            {t('createWorkspace')}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
