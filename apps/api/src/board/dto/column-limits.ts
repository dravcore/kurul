/**
 * `Column.name`'s ceiling, shared by `CreateColumnDto`/`UpdateColumnDto` and the Trello importer.
 *
 * One number rather than two, so a name the HTTP write path would refuse as too long can never
 * reach the database by a different door (SEC-04): the importer clamps to this same constant
 * instead of writing the export's list name verbatim.
 */
export const MAX_COLUMN_NAME_LENGTH = 120;
