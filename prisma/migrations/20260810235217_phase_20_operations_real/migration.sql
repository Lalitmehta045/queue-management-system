-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('OPEN', 'PAUSED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'QUEUE_PAUSED';
ALTER TYPE "AuditAction" ADD VALUE 'QUEUE_RESUMED';

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "queueStatus" "QueueStatus" NOT NULL DEFAULT 'OPEN';

