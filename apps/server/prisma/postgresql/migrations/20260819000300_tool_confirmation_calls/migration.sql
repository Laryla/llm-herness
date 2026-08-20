DROP INDEX "ToolConfirmation_stepId_key";
ALTER TABLE "ToolConfirmation" ADD COLUMN "toolCallId" TEXT;
ALTER TABLE "ToolConfirmation" ADD COLUMN "toolId" TEXT;
UPDATE "ToolConfirmation" SET "toolCallId" = "id", "toolId" = 'tool_legacy';
ALTER TABLE "ToolConfirmation" ALTER COLUMN "toolCallId" SET NOT NULL;
ALTER TABLE "ToolConfirmation" ALTER COLUMN "toolId" SET NOT NULL;
CREATE UNIQUE INDEX "ToolConfirmation_stepId_toolCallId_key" ON "ToolConfirmation"("stepId", "toolCallId");
