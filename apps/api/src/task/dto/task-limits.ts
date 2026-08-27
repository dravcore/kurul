/** A year of working minutes — an estimate past this is a typo, not a plan. */
export const MAX_ESTIMATED_MINUTES = 60 * 24 * 365;

/**
 * `Task.title`'s ceiling, shared by `CreateTaskDto`/`UpdateTaskDto` and the Trello importer.
 *
 * One number rather than two, so a title the HTTP write path would refuse as too long can
 * never reach the database by a different door (SEC-04): the importer clamps to this same
 * constant instead of writing `card.name` verbatim.
 */
export const MAX_TASK_TITLE_LENGTH = 500;

/** `Task.description`'s ceiling, shared the same way `MAX_TASK_TITLE_LENGTH` is. */
export const MAX_TASK_DESCRIPTION_LENGTH = 20_000;

/** `Checklist.title`'s ceiling, shared by the checklist DTOs and the Trello importer. */
export const MAX_CHECKLIST_TITLE_LENGTH = 255;
