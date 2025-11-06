-- CreateEnum
CREATE TYPE "ProofType" AS ENUM ('RANDOM', 'FINAL');

-- CreateTable
CREATE TABLE "PeriodicProof" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "photoUrl" TEXT NOT NULL,
    "proofType" "ProofType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PeriodicProof_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PeriodicProof_assignmentId_idx" ON "PeriodicProof"("assignmentId");

-- AddForeignKey
ALTER TABLE "PeriodicProof" ADD CONSTRAINT "PeriodicProof_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
