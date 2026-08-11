-- CreateEnum
CREATE TYPE "TokenStatus" AS ENUM ('WAITING', 'CANCELLED');

-- CreateTable
CREATE TABLE "TokenSequence" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "businessDate" DATE NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TokenSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Token" (
    "id" UUID NOT NULL,
    "queueEntryId" UUID NOT NULL,
    "sequenceId" UUID NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "displayNumber" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "status" "TokenStatus" NOT NULL DEFAULT 'WAITING',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TokenSequence_branchId_serviceId_businessDate_key" ON "TokenSequence"("branchId", "serviceId", "businessDate");
CREATE INDEX "TokenSequence_branchId_businessDate_idx" ON "TokenSequence"("branchId", "businessDate");
CREATE UNIQUE INDEX "Token_queueEntryId_key" ON "Token"("queueEntryId");
CREATE UNIQUE INDEX "Token_sequenceId_sequenceNumber_key" ON "Token"("sequenceId", "sequenceNumber");
CREATE UNIQUE INDEX "Token_sequenceId_displayNumber_key" ON "Token"("sequenceId", "displayNumber");
CREATE INDEX "Token_businessDate_status_idx" ON "Token"("businessDate", "status");

-- AddForeignKey
ALTER TABLE "TokenSequence" ADD CONSTRAINT "TokenSequence_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TokenSequence" ADD CONSTRAINT "TokenSequence_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Token" ADD CONSTRAINT "Token_queueEntryId_fkey" FOREIGN KEY ("queueEntryId") REFERENCES "QueueEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Token" ADD CONSTRAINT "Token_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "TokenSequence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
