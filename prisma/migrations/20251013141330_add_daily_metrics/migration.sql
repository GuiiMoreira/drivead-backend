-- CreateTable
CREATE TABLE "DailyAssignmentMetric" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kilometersDriven" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "timeInMotionSeconds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyAssignmentMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyAssignmentMetric_assignmentId_date_key" ON "DailyAssignmentMetric"("assignmentId", "date");

-- AddForeignKey
ALTER TABLE "DailyAssignmentMetric" ADD CONSTRAINT "DailyAssignmentMetric_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
