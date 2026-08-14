import { describe, expect, it } from 'vitest';
import { ActivityType, AUDIT_ACTIVITY_TYPES } from '../src/activity.js';

/**
 * `Activity.type` is a free-text column, so nothing in the database rejects a typo: the row is
 * written, and only the query that later fails to find it notices. For the audit events that
 * matters more than for the task feed — an entry that answers "who removed this member" is
 * worth nothing if it was filed under a name the incident query does not ask for.
 */
describe('ActivityType', () => {
  it('names every event `<subject>.<verb>` in lower case', () => {
    for (const value of Object.values(ActivityType)) {
      expect(value).toMatch(/^[a-z]+\.[a-z_]+$/);
    }
  });

  it('has no duplicate values', () => {
    const values = Object.values(ActivityType);
    expect(new Set(values).size).toBe(values.length);
  });

  it('has no `workspace.deleted` — the row would cascade with the workspace it describes', () => {
    // `WorkspaceService.remove` logs that event instead. If this ever starts failing, the
    // reason it was excluded (`Activity.workspaceId` is `onDelete: Cascade`) has to be
    // revisited before the constant is added, not after.
    expect(Object.values(ActivityType)).not.toContain('workspace.deleted');
  });
});

describe('AUDIT_ACTIVITY_TYPES', () => {
  it('contains only declared activity types', () => {
    const declared = new Set<string>(Object.values(ActivityType));
    for (const type of AUDIT_ACTIVITY_TYPES) {
      expect(declared).toContain(type);
    }
  });

  it('covers every administrative subject', () => {
    // The list is what an incident query passes to `type = ANY(...)`, so a subject missing
    // from it is a class of event that silently stops being auditable. Asserted by subject
    // prefix rather than by a copy of the list, which would just be the same array twice.
    const subjects = new Set(AUDIT_ACTIVITY_TYPES.map((type) => type.split('.')[0]));
    expect(subjects).toEqual(
      new Set(['task', 'board', 'column', 'label', 'workspace', 'member', 'invitation']),
    );
  });

  it('excludes the high-volume content events', () => {
    // Task edits, moves, assignments and comments outnumber everything else here by orders of
    // magnitude and change nobody's access; `task.deleted` is the one content event kept,
    // because it destroys rather than edits.
    const excluded = [
      ActivityType.TaskCreated,
      ActivityType.TaskUpdated,
      ActivityType.TaskMoved,
      ActivityType.TaskAssigned,
      ActivityType.TaskUnassigned,
      ActivityType.CommentCreated,
    ];
    for (const type of excluded) {
      expect(AUDIT_ACTIVITY_TYPES).not.toContain(type);
    }
    expect(AUDIT_ACTIVITY_TYPES).toContain(ActivityType.TaskDeleted);
  });
});
