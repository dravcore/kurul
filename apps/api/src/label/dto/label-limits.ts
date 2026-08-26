/**
 * `Label.name`'s ceiling, shared by `CreateLabelDto`/`UpdateLabelDto` and the Trello importer.
 *
 * One number rather than two, so a name the HTTP write path would refuse as too long can never
 * reach the database by a different door (SEC-04): the importer clamps to this same constant
 * instead of writing an oversized Trello label name verbatim.
 */
export const MAX_LABEL_NAME_LENGTH = 50;
