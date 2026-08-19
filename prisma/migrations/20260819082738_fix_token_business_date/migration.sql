/*
  Warnings:

  - You are about to drop the column `currentBusinessDate` on the `Branch` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "Token_sequenceId_displayNumber_key";

-- DropIndex
DROP INDEX "Token_sequenceId_sequenceNumber_key";

-- AlterTable
ALTER TABLE "Branch" DROP COLUMN "currentBusinessDate";
