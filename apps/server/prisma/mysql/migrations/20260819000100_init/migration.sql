-- CreateTable
CREATE TABLE `HarnessSettings` (
    `id` VARCHAR(191) NOT NULL,
    `currentWorkspaceId` VARCHAR(191) NULL,
    `currentModelProfileId` VARCHAR(191) NULL,
    `currentModelName` VARCHAR(191) NULL,
    `currentToolIds` JSON NOT NULL,
    `maxIterations` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Workspace` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `path` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Workspace_path_key`(`path`),
    INDEX `Workspace_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ModelProfile` (
    `id` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(191) NOT NULL,
    `baseUrl` VARCHAR(191) NOT NULL,
    `secretSource` VARCHAR(191) NOT NULL,
    `secretReference` VARCHAR(191) NOT NULL,
    `maskedSecret` VARCHAR(191) NOT NULL,
    `connectionStatus` VARCHAR(191) NOT NULL,
    `connectionTestedAt` DATETIME(3) NULL,
    `connectionLatencyMs` INTEGER NULL,
    `connectionError` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ModelCatalogEntry` (
    `id` VARCHAR(191) NOT NULL,
    `profileId` VARCHAR(191) NOT NULL,
    `modelName` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ModelCatalogEntry_profileId_source_idx`(`profileId`, `source`),
    UNIQUE INDEX `ModelCatalogEntry_profileId_modelName_key`(`profileId`, `modelName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Conversation` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `title` LONGTEXT NOT NULL,
    `titleSource` VARCHAR(191) NOT NULL,
    `instructions` LONGTEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Conversation_workspaceId_updatedAt_idx`(`workspaceId`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Turn` (
    `id` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `userMessage` LONGTEXT NOT NULL,
    `modelSelectionSnapshot` JSON NOT NULL,
    `modelParametersSnapshot` JSON NOT NULL,
    `toolBindingSnapshot` JSON NOT NULL,
    `instructionsSnapshot` LONGTEXT NOT NULL,
    `maxIterations` INTEGER NOT NULL,
    `error` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Turn_conversationId_createdAt_idx`(`conversationId`, `createdAt`),
    INDEX `Turn_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Step` (
    `id` VARCHAR(191) NOT NULL,
    `turnId` VARCHAR(191) NOT NULL,
    `iterationIndex` INTEGER NULL,
    `sequence` INTEGER NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `input` JSON NOT NULL,
    `output` JSON NULL,
    `error` JSON NULL,
    `usage` JSON NULL,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Step_turnId_iterationIndex_idx`(`turnId`, `iterationIndex`),
    UNIQUE INDEX `Step_turnId_sequence_key`(`turnId`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Message` (
    `id` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `turnId` VARCHAR(191) NOT NULL,
    `stepId` VARCHAR(191) NULL,
    `sequence` INTEGER NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NULL,
    `content` LONGTEXT NOT NULL,
    `toolCallId` VARCHAR(191) NULL,
    `toolId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Message_turnId_sequence_idx`(`turnId`, `sequence`),
    UNIQUE INDEX `Message_conversationId_sequence_key`(`conversationId`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QueuedMessage` (
    `id` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `content` LONGTEXT NOT NULL,
    `position` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `QueuedMessage_conversationId_status_position_idx`(`conversationId`, `status`, `position`),
    UNIQUE INDEX `QueuedMessage_conversationId_position_key`(`conversationId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ToolConfirmation` (
    `id` VARCHAR(191) NOT NULL,
    `stepId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `arguments` JSON NOT NULL,
    `decidedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ToolConfirmation_stepId_key`(`stepId`),
    INDEX `ToolConfirmation_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ModelCatalogEntry` ADD CONSTRAINT `ModelCatalogEntry_profileId_fkey` FOREIGN KEY (`profileId`) REFERENCES `ModelProfile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Conversation` ADD CONSTRAINT `Conversation_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Turn` ADD CONSTRAINT `Turn_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Step` ADD CONSTRAINT `Step_turnId_fkey` FOREIGN KEY (`turnId`) REFERENCES `Turn`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_turnId_fkey` FOREIGN KEY (`turnId`) REFERENCES `Turn`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_stepId_fkey` FOREIGN KEY (`stepId`) REFERENCES `Step`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QueuedMessage` ADD CONSTRAINT `QueuedMessage_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ToolConfirmation` ADD CONSTRAINT `ToolConfirmation_stepId_fkey` FOREIGN KEY (`stepId`) REFERENCES `Step`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
