ALTER TABLE `ToolConfirmation`
  DROP INDEX `ToolConfirmation_stepId_key`,
  ADD COLUMN `toolCallId` VARCHAR(191) NULL,
  ADD COLUMN `toolId` VARCHAR(191) NULL;
UPDATE `ToolConfirmation` SET `toolCallId` = `id`, `toolId` = 'tool_legacy';
ALTER TABLE `ToolConfirmation`
  MODIFY `toolCallId` VARCHAR(191) NOT NULL,
  MODIFY `toolId` VARCHAR(191) NOT NULL,
  ADD UNIQUE INDEX `ToolConfirmation_stepId_toolCallId_key`(`stepId`, `toolCallId`);
