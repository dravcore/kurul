'use client';

import Link from 'next/link';
import { ChevronsUpDown, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
          aria-label={collapsed ? t('switchWorkspace') : undefined}
          className={cn(
            'h-10 justify-start gap-2 px-2',
            collapsed ? 'w-10 justify-center px-0' : 'w-full',
          )}
        >
          {/* `bg-muted text-foreground-secondary`, not the signature tint: this initial names
              which workspace is open, it does not mean "active" the way the sancak rail does
              (docs/design.md §2), so it wears a neutral. `--muted` rather than `--accent`
              because the enclosing ghost Button paints `hover:bg-accent`, which would dissolve
              the chip's square into the button for as long as the pointer rests on it. */}
          <span
            aria-hidden
            className="flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-muted text-small font-strong text-foreground-secondary"
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
        <DropdownMenuRadioGroup value={activeId} onValueChange={(value) => void onSwitch(value)}>
          {workspaces.map((workspace) => (
            <DropdownMenuRadioItem key={workspace.id} value={workspace.id}>
              <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
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
