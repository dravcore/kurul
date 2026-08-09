-- AlterForeignKey: keep workspace activity history when a task is deleted.
ALTER TABLE "Activity" DROP CONSTRAINT "Activity_taskId_fkey";

ALTER TABLE "Activity" ADD CONSTRAINT "Activity_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
