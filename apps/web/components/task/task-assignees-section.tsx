'use client';

import { useTranslations } from 'next-intl';
import type { WorkspaceMemberDto } from '@kurul/shared-types';

interface TaskAssigneesSectionProps {
  members: WorkspaceMemberDto[];
  assignedUserIds: ReadonlySet<string>;
  disabled: boolean;
  onToggle: (userId: string, assigned: boolean) => void;
}

/** Workspace members as checkboxes — assignment is a membership, not a single owner. */
export function TaskAssigneesSection({
  members,
  assignedUserIds,
  disabled,
  onToggle,
}: TaskAssigneesSectionProps): React.ReactElement {
  const t = useTranslations('app.board.task');

  return (
    <div className="flex flex-col gap-2">
      <p className="text-small font-strong text-foreground">{t('assignees')}</p>
      <ul className="flex flex-col gap-1">
        {members.map((member) => {
          const assigned = assignedUserIds.has(member.userId);
          return (
            <li key={member.id}>
              <label className="flex cursor-pointer items-center gap-2 text-body max-md:min-h-11">
                <input
                  type="checkbox"
                  checked={assigned}
                  disabled={disabled}
                  onChange={() => onToggle(member.userId, assigned)}
                />
                <span>{member.name}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
