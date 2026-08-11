-- CreateEnum
CREATE TYPE "CounterStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "Counter" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "CounterStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Counter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CounterAssignment" (
    "id" UUID NOT NULL,
    "counterId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CounterAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Counter_branchId_code_key" ON "Counter"("branchId", "code");
CREATE INDEX "Counter_branchId_idx" ON "Counter"("branchId");
CREATE INDEX "Counter_branchId_status_idx" ON "Counter"("branchId", "status");
CREATE UNIQUE INDEX "CounterAssignment_counterId_userId_key" ON "CounterAssignment"("counterId", "userId");
CREATE INDEX "CounterAssignment_counterId_idx" ON "CounterAssignment"("counterId");
CREATE INDEX "CounterAssignment_userId_idx" ON "CounterAssignment"("userId");

-- AddForeignKey
ALTER TABLE "Counter" ADD CONSTRAINT "Counter_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CounterAssignment" ADD CONSTRAINT "CounterAssignment_counterId_fkey" FOREIGN KEY ("counterId") REFERENCES "Counter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CounterAssignment" ADD CONSTRAINT "CounterAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;