/**
 * The slice of multer's file object this module reads.
 *
 * Declared structurally rather than imported: `@types/multer` is not a dependency here and
 * multer ships no types of its own, so adding one would pull a `@types` package into the API
 * for four fields. The same call `smtp-mail-sender.ts:11-29` makes about nodemailer's
 * `Transporter`, for the same reason — this surface is small and stable.
 *
 * `buffer` is present because the interceptor is configured with `memoryStorage()`. That is not
 * a convenience: a disk-backed multer creates a file *before* validation runs, which is exactly
 * the thing §4.1c's measurement 2(a) goes looking for.
 *
 * `size` is here because multer reports it, and it is deliberately *not* what reaches the row:
 * the stored size is `buffer.length`, so `Content-Length` on the download can never disagree
 * with the bytes that were written.
 */
export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}
