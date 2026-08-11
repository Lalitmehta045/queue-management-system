-- CreateTable
CREATE TABLE "Display" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "publicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Display_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Display_publicId_key" ON "Display"("publicId");
CREATE UNIQUE INDEX "Display_branchId_name_key" ON "Display"("branchId", "name");
CREATE INDEX "Display_branchId_active_idx" ON "Display"("branchId", "active");

-- AddForeignKey
ALTER TABLE "Display" ADD CONSTRAINT "Display_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
