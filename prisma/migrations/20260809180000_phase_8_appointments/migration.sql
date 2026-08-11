-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED','CONFIRMED','CHECKED_IN','COMPLETED','CANCELLED','NO_SHOW');

-- AddColumn
ALTER TABLE "Service" ADD COLUMN "durationMinutes" INTEGER NOT NULL DEFAULT 15;

-- CreateTable
CREATE TABLE "Appointment" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "appointmentDate" DATE NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "Appointment_branchId_appointmentDate_idx" ON "Appointment"("branchId", "appointmentDate");
CREATE INDEX "Appointment_serviceId_appointmentDate_idx" ON "Appointment"("serviceId", "appointmentDate");
CREATE INDEX "Appointment_patientId_appointmentDate_idx" ON "Appointment"("patientId", "appointmentDate");

-- ForeignKeys
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable BranchWorkingHours
CREATE TABLE "BranchWorkingHours" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "openTime" TEXT NOT NULL,
    "closeTime" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchWorkingHours_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "BranchWorkingHours_branchId_dayOfWeek_key" ON "BranchWorkingHours"("branchId", "dayOfWeek");
CREATE INDEX "BranchWorkingHours_branchId_active_idx" ON "BranchWorkingHours"("branchId", "active");

-- ForeignKeys
ALTER TABLE "BranchWorkingHours" ADD CONSTRAINT "BranchWorkingHours_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Unique constraint to prevent double booking per service+date+start
CREATE UNIQUE INDEX "Appointment_service_date_start_key" ON "Appointment"("serviceId", "appointmentDate", "startAt");

