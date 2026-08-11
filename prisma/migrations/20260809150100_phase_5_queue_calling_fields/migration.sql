-- Add counter/operator attribution and lifecycle timestamps after the enum values commit.
ALTER TABLE "Token"
  ADD COLUMN "counterId" UUID,
  ADD COLUMN "operatorId" UUID,
  ADD COLUMN "calledAt" TIMESTAMP(3),
  ADD COLUMN "servingAt" TIMESTAMP(3),
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "skippedAt" TIMESTAMP(3),
  ADD COLUMN "recalledAt" TIMESTAMP(3),
  ADD COLUMN "recallCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Token_counterId_status_idx" ON "Token"("counterId", "status");
CREATE INDEX "Token_operatorId_status_idx" ON "Token"("operatorId", "status");

ALTER TABLE "Token" ADD CONSTRAINT "Token_counterId_fkey" FOREIGN KEY ("counterId") REFERENCES "Counter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Token" ADD CONSTRAINT "Token_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Token_one_active_per_counter_idx"
  ON "Token"("counterId")
  WHERE "counterId" IS NOT NULL AND "status" IN ('CALLED', 'SERVING');