PRAGMA foreign_keys=OFF;

CREATE TABLE "new_ToolConfirmation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stepId" TEXT NOT NULL,
    "toolCallId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "arguments" JSONB NOT NULL,
    "decidedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ToolConfirmation_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "Step" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_ToolConfirmation" ("id", "stepId", "toolCallId", "toolId", "status", "arguments", "decidedAt", "createdAt", "updatedAt")
SELECT "id", "stepId", "id", 'tool_legacy', "status", "arguments", "decidedAt", "createdAt", "updatedAt" FROM "ToolConfirmation";

DROP TABLE "ToolConfirmation";
ALTER TABLE "new_ToolConfirmation" RENAME TO "ToolConfirmation";
CREATE UNIQUE INDEX "ToolConfirmation_stepId_toolCallId_key" ON "ToolConfirmation"("stepId", "toolCallId");
CREATE INDEX "ToolConfirmation_status_idx" ON "ToolConfirmation"("status");

PRAGMA foreign_keys=ON;
