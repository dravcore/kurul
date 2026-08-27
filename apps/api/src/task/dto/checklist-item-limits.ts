/**
 * `ChecklistItem.content`'s ceiling, shared by `CreateChecklistItemDto`/`UpdateChecklistItemDto`
 * and the Trello importer.
 *
 * One number rather than two, so content the HTTP write path would refuse as too long can never
 * reach the database by a different door (SEC-04): the importer clamps to this same constant
 * instead of writing a Trello check item's name verbatim.
 */
export const MAX_CHECKLIST_ITEM_CONTENT_LENGTH = 1_000;
