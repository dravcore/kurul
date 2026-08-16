-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('FILE', 'LINK');

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "kind" "AttachmentKind" NOT NULL,
    "filename" TEXT NOT NULL,
    "storageKey" TEXT,
    "mimeType" TEXT,
    "size" INTEGER,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Attachment_taskId_id_idx" ON "Attachment"("taskId", "id");

-- CreateIndex
CREATE INDEX "Attachment_uploadedById_idx" ON "Attachment"("uploadedById");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
