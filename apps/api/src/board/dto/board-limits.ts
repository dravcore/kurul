/**
 * `Board.name`'s ceiling, shared by `CreateBoardDto`/`UpdateBoardDto` and the Trello importer.
 *
 * One number rather than two, so a name the HTTP write path would refuse as too long can never
 * reach the database by a different door (SEC-04): the importer clamps to this same constant
 * instead of writing the export's board name verbatim.
 */
export const MAX_BOARD_NAME_LENGTH = 120;

/** `Board.description`'s ceiling, shared the same way `MAX_BOARD_NAME_LENGTH` is. */
export const MAX_BOARD_DESCRIPTION_LENGTH = 2_000;
