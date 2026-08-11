-- CreateEnum
CREATE TYPE "QueueEntryStatus" AS ENUM ('WAITING', 'CANCELLED');

-- CreateTable
CREATE TABLE "QueueEntry" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "status" "QueueEntryStatus" NOT NULL DEFAULT 'WAITING',
    "activeEntryKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QueueEntry_activeEntryKey_key" ON "QueueEntry"("activeEntryKey");

-- CreateIndex
CREATE INDEX "QueueEntry_patientId_createdAt_idx" ON "QueueEntry"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "QueueEntry_serviceId_createdAt_idx" ON "QueueEntry"("serviceId", "createdAt");

-- CreateIndex
CREATE INDEX "QueueEntry_status_createdAt_idx" ON "QueueEntry"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
