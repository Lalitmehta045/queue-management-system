-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'TOKEN_SEQUENCE_RESET';

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "currentBusinessDate" DATE;
