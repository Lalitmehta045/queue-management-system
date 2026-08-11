-- CreateEnum
CREATE TYPE "PatientStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "Patient" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "patientNumber" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "status" "PatientStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Patient_branchId_idx" ON "Patient"("branchId");

-- CreateIndex
CREATE INDEX "Patient_branchId_status_idx" ON "Patient"("branchId", "status");

-- CreateIndex
CREATE INDEX "Patient_branchId_lastName_firstName_idx" ON "Patient"("branchId", "lastName", "firstName");

-- CreateIndex
CREATE INDEX "Patient_branchId_phone_idx" ON "Patient"("branchId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_branchId_patientNumber_key" ON "Patient"("branchId", "patientNumber");

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
