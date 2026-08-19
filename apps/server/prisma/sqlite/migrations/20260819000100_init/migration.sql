-- CreateTable
CREATE TABLE "HarnessSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "currentWorkspaceId" TEXT,
    "currentModelProfileId" TEXT,
    "currentModelName" TEXT,
    "currentToolIds" JSONB NOT NULL,
    "maxIterations" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ModelProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "secretSource" TEXT NOT NULL,
    "secretReference" TEXT NOT NULL,
    "maskedSecret" TEXT NOT NULL,
    "connectionStatus" TEXT NOT NULL,
    "connectionTestedAt" DATETIME,
    "connectionLatencyMs" INTEGER,
    "connectionError" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ModelCatalogEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ModelCatalogEntry_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "ModelProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleSource" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Conversation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Turn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "userMessage" TEXT NOT NULL,
    "modelSelectionSnapshot" JSONB NOT NULL,
    "modelParametersSnapshot" JSONB NOT NULL,
    "toolBindingSnapshot" JSONB NOT NULL,
    "instructionsSnapshot" TEXT NOT NULL,
    "maxIterations" INTEGER NOT NULL,
    "error" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Turn_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Step" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "turnId" TEXT NOT NULL,
    "iterationIndex" INTEGER,
    "sequence" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error" JSONB,
    "usage" JSONB,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Step_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "Turn" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "stepId" TEXT,
    "sequence" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "source" TEXT,
    "content" TEXT NOT NULL,
    "toolCallId" TEXT,
    "toolId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Message_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "Turn" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Message_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "Step" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QueuedMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QueuedMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ToolConfirmation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stepId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "arguments" JSONB NOT NULL,
    "decidedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ToolConfirmation_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "Step" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_path_key" ON "Workspace"("path");

-- CreateIndex
CREATE INDEX "Workspace_status_idx" ON "Workspace"("status");

-- CreateIndex
CREATE INDEX "ModelCatalogEntry_profileId_source_idx" ON "ModelCatalogEntry"("profileId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "ModelCatalogEntry_profileId_modelName_key" ON "ModelCatalogEntry"("profileId", "modelName");

-- CreateIndex
CREATE INDEX "Conversation_workspaceId_updatedAt_idx" ON "Conversation"("workspaceId", "updatedAt");

-- CreateIndex
CREATE INDEX "Turn_conversationId_createdAt_idx" ON "Turn"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Turn_status_idx" ON "Turn"("status");

-- CreateIndex
CREATE INDEX "Step_turnId_iterationIndex_idx" ON "Step"("turnId", "iterationIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Step_turnId_sequence_key" ON "Step"("turnId", "sequence");

-- CreateIndex
CREATE INDEX "Message_turnId_sequence_idx" ON "Message"("turnId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "Message_conversationId_sequence_key" ON "Message"("conversationId", "sequence");

-- CreateIndex
CREATE INDEX "QueuedMessage_conversationId_status_position_idx" ON "QueuedMessage"("conversationId", "status", "position");

-- CreateIndex
CREATE UNIQUE INDEX "QueuedMessage_conversationId_position_key" ON "QueuedMessage"("conversationId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ToolConfirmation_stepId_key" ON "ToolConfirmation"("stepId");

-- CreateIndex
CREATE INDEX "ToolConfirmation_status_idx" ON "ToolConfirmation"("status");
