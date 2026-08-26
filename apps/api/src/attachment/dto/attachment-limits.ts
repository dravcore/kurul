/**
 * `Attachment.url`'s ceiling, shared by `CreateAttachmentDto` and the Trello importer.
 *
 * One number rather than two, so a URL the HTTP write path would refuse as too long can never
 * reach the database by a different door (SEC-04): the importer clamps to this same constant
 * instead of writing a Trello attachment URL verbatim.
 */
export const MAX_ATTACHMENT_URL_LENGTH = 2_048;
