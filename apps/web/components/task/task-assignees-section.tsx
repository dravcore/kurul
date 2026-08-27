'use client';

import { useTranslations } from 'next-intl';
import type { WorkspaceMemberDto } from '@kurul/shared-types';
import { chipShell } from './label-chip';
import { INLINE_PICKER_MAX, SearchablePicker } from './searchable-picker';

interface TaskAssigneesSectionProps {
  members: WorkspaceMemberDto[];
  assignedUserIds: ReadonlySet<string>;
  /** The reader may not write at all. A permission lock, never a request in flight. */
  disabled: boolean;
  /** Members whose own assign or unassign has not come back yet. */
  pendingUserIds: ReadonlySet<string>;
  onToggle: (userId: string, assigned: boolean) => void;
}

/**
 * Workspace members as checkboxes: assignment is a membership, not a single owner.
 *
 * A row whose write is out stays enabled and refuses the toggle rather than going `disabled`,
 * which is what a browser blurs (docs/design.md §6): the reader is standing on the row they
 * just pressed, and every other row keeps working.
 */
export function TaskAssigneesSection({
  members,
  assignedUserIds,
  disabled,
  pendingUserIds,
  onToggle,
}: TaskAssigneesSectionProps): React.ReactElement {
  const t = useTranslations('app.board.task');

  const assigned = members.filter((member) => assignedUserIds.has(member.userId));

  return (
    <div className="flex flex-col gap-2">
      <p className="text-small font-strong text-foreground">{t('assignees')}</p>
      {members.length > INLINE_PICKER_MAX ? (
        <div className="flex flex-wrap items-center gap-2">
          {/* The checkbox list was the only thing saying who is on the task. Behind a popover it
              no longer is, so the names come out in front of the trigger. */}
          {assigned.length === 0 ? (
            <span className="text-small text-muted-foreground">{t('noAssignees')}</span>
          ) : (
            /* Each name in `chipShell`, the same shell the labels beside it wear, minus the
               colour dot: two bare names in a row read as one string the moment either of them
               has a space in it, and every name does. */
            <ul className="flex flex-wrap gap-1.5">
              {assigned.map((member) => (
                <li key={member.id} className={chipShell}>
                  {member.name}
                </li>
              ))}
            </ul>
          )}
          <SearchablePicker
            triggerLabel={t('assignAction', { count: assigned.length })}
            searchLabel={t('searchMembers')}
            emptyLabel={t('noMatches')}
            disabled={disabled}
            pendingIds={pendingUserIds}
            options={members.map((member) => ({
              id: member.userId,
              name: member.name,
              selected: assignedUserIds.has(member.userId),
            }))}
            onToggle={onToggle}
          />
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {members.map((member) => {
            const isAssigned = assignedUserIds.has(member.userId);
            const saving = pendingUserIds.has(member.userId);
            return (
              <li key={member.id}>
                <label className="flex cursor-pointer items-center gap-2 text-body max-md:min-h-11">
                  <input
                    type="checkbox"
                    checked={isAssigned}
                    disabled={disabled}
                    aria-disabled={saving || undefined}
                    onChange={() => {
                      if (saving) return;
                      onToggle(member.userId, isAssigned);
                    }}
                  />
                  <span>{member.name}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
