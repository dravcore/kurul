import type { AttachmentDto, AttachmentKind } from '@kurultay/shared-types';

/** The row shape both reads produce. Spelled out so unit tests can build one by hand. */
export type AttachmentRow = {
  id: string;
  taskId: string;
  kind: AttachmentKind;
  filename: string;
  storageKey: string | null;
  mimeType: string | null;
  size: number | null;
  url: string | null;
  uploadedById: string;
  createdAt: Date;
};

/**
 * Row → DTO. Pure: no Prisma, no exceptions, no side effects — the same split `task.mapper.ts`
 * keeps.
 *
 * `storageKey` is deliberately **not** in `AttachmentDto` and therefore not mapped here. It is
 * an internal address; publishing it would invite a client to construct one, which is the exact
 * capability K9 removed.
 */
export function toAttachmentDto(row: AttachmentRow): AttachmentDto {
  return {
    id: row.id,
    taskId: row.taskId,
    kind: row.kind,
    filename: row.filename,
    mimeType: row.mimeType,
    size: row.size,
    url: row.url,
    uploadedById: row.uploadedById,
    createdAt: row.createdAt.toISOString(),
  };
}
