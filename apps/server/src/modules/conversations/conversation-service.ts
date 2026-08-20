import { randomUUID } from "node:crypto";

import type {
  Conversation,
  CreateConversationRequest,
  Iteration,
  Message,
  QueuedMessage,
  SteeringMessage,
  Trace,
  Turn,
  UpdateConversationRequest,
} from "@llm-harness/contracts";

import type { PersistenceClient } from "../../infrastructure/database/database.js";
import {
  iterationId,
  serializeConversation,
  serializeMessage,
  serializeStep,
  serializeTurn,
} from "./conversation-serialization.js";

export interface ConversationLogger {
  info(context: Record<string, unknown>, message: string): void;
}

const silentLogger: ConversationLogger = { info: () => undefined };

export class ConversationServiceError extends Error {
  constructor(
    readonly code:
      | "conversation_not_found"
      | "turn_not_found"
      | "workspace_not_found"
      | "conversation_busy",
    message: string,
  ) {
    super(message);
    this.name = "ConversationServiceError";
  }
}

function createId(): string {
  return `conversation_${randomUUID().replaceAll("-", "")}`;
}

function temporaryTitle(firstMessage: string): string {
  return Array.from(firstMessage.trim()).slice(0, 30).join("");
}

/** Conversation、历史消息、Turn 列表和 Trace 的统一查询/修改入口。 */
export class ConversationService {
  constructor(
    private readonly client: PersistenceClient,
    private readonly logger: ConversationLogger = silentLogger,
  ) {}

  async list(workspaceId?: string): Promise<Conversation[]> {
    const records = await this.client.conversation.findMany({
      ...(workspaceId ? { where: { workspaceId } } : {}),
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    });
    return records.map(serializeConversation);
  }

  async get(id: string): Promise<Conversation> {
    return serializeConversation(await this.findConversation(id));
  }

  /** 创建空 Conversation；firstMessage 只用于首次临时标题，正式消息由 turn.create 保存。 */
  async create(input: CreateConversationRequest): Promise<Conversation> {
    const workspace = await this.client.workspace.findUnique({
      where: { id: input.workspaceId },
    });
    if (!workspace) {
      throw new ConversationServiceError("workspace_not_found", "Workspace 不存在");
    }
    const record = await this.client.conversation.create({
      data: {
        id: createId(),
        workspaceId: input.workspaceId,
        title: temporaryTitle(input.firstMessage),
        titleSource: "temporary",
        instructions: input.instructions,
      },
    });
    this.logger.info(
      { conversationId: record.id, workspaceId: record.workspaceId },
      "Conversation 创建完成",
    );
    return serializeConversation(record);
  }

  async update(
    id: string,
    input: UpdateConversationRequest,
  ): Promise<Conversation> {
    await this.findConversation(id);
    const record = await this.client.conversation.update({
      where: { id },
      data: {
        ...(input.title === undefined
          ? {}
          : { title: input.title.trim(), titleSource: "user" }),
        ...(input.instructions === undefined
          ? {}
          : { instructions: input.instructions }),
      },
    });
    this.logger.info(
      {
        changedInstructions: input.instructions !== undefined,
        changedTitle: input.title !== undefined,
        conversationId: id,
      },
      "Conversation 更新完成",
    );
    return serializeConversation(record);
  }

  async remove(id: string): Promise<void> {
    await this.findConversation(id);
    const activeTurn = await this.client.turn.findFirst({
      where: {
        conversationId: id,
        status: { in: ["queued", "running", "awaiting_confirmation"] },
      },
      select: { id: true },
    });
    if (activeTurn) {
      throw new ConversationServiceError(
        "conversation_busy",
        "Conversation 存在活动 Turn，不能删除",
      );
    }
    await this.client.conversation.delete({ where: { id } });
    this.logger.info({ conversationId: id }, "Conversation 删除完成");
  }

  async listMessages(conversationId: string): Promise<Message[]> {
    await this.findConversation(conversationId);
    const records = await this.client.message.findMany({
      where: { conversationId },
      orderBy: [{ sequence: "asc" }, { id: "asc" }],
    });
    return records.map(serializeMessage);
  }

  async listTurns(conversationId: string): Promise<Turn[]> {
    await this.findConversation(conversationId);
    const records = await this.client.turn.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return records.map(serializeTurn);
  }

  async listQueuedMessages(conversationId: string): Promise<QueuedMessage[]> {
    await this.findConversation(conversationId);
    const records = await this.client.queuedMessage.findMany({
      where: { conversationId },
      orderBy: [{ position: "asc" }, { id: "asc" }],
    });
    return records.map((record) => ({
      id: record.id,
      conversationId: record.conversationId,
      content: record.content,
      position: record.position,
      status: record.status as QueuedMessage["status"],
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    }));
  }

  async getTrace(conversationId: string, turnId: string): Promise<Trace> {
    await this.findConversation(conversationId);
    const turn = await this.client.turn.findFirst({
      where: { id: turnId, conversationId },
      include: {
        steps: { orderBy: [{ sequence: "asc" }, { id: "asc" }] },
        messages: {
          where: { role: "user", source: "steering" },
          orderBy: [{ sequence: "asc" }, { id: "asc" }],
        },
      },
    });
    if (!turn) {
      throw new ConversationServiceError("turn_not_found", "Turn 不存在");
    }
    const iterations: Iteration[] = turn.steps.flatMap((step) =>
      step.iterationIndex
        ? [
            {
              id: iterationId(turn.id, step.iterationIndex),
              turnId: turn.id,
              index: step.iterationIndex,
              status: iterationStatus(step.status),
              createdAt: step.createdAt.toISOString(),
              ...(step.completedAt
                ? { completedAt: step.completedAt.toISOString() }
                : {}),
            },
          ]
        : [],
    );
    const steeringMessages: SteeringMessage[] = turn.messages.map((message) => ({
      id: message.id,
      conversationId: message.conversationId,
      turnId: message.turnId,
      content: message.content,
      status: "applied",
      createdAt: message.createdAt.toISOString(),
      appliedAt: message.createdAt.toISOString(),
    }));
    return {
      turn: serializeTurn(turn),
      iterations,
      steps: turn.steps.map(serializeStep),
      steeringMessages,
    };
  }

  private async findConversation(id: string) {
    const record = await this.client.conversation.findUnique({ where: { id } });
    if (!record) {
      throw new ConversationServiceError(
        "conversation_not_found",
        "Conversation 不存在",
      );
    }
    return record;
  }
}

function iterationStatus(status: string): Iteration["status"] {
  if (status === "cancelled") {
    return "cancelled";
  }
  if (status === "interrupted") {
    return "interrupted";
  }
  return status === "completed" ? "completed" : "running";
}

/** Server 启动时终止上次进程遗留的活动状态，绝不自动重放副作用。 */
export async function interruptActiveTurns(
  client: PersistenceClient,
): Promise<{ turns: number; steps: number }> {
  const now = new Date();
  return client.$transaction(async (transaction) => {
    const steps = await transaction.step.updateMany({
      where: {
        status: { in: ["pending", "running", "awaiting_confirmation"] },
        turn: {
          status: { in: ["queued", "running", "awaiting_confirmation"] },
        },
      },
      data: { status: "interrupted", completedAt: now },
    });
    const turns = await transaction.turn.updateMany({
      where: { status: { in: ["queued", "running", "awaiting_confirmation"] } },
      data: {
        status: "interrupted",
        completedAt: now,
        error: {
          code: "server_restarted",
          message: "Server 重启，未完成的 Turn 已中断",
          retryable: false,
        },
      },
    });
    return { turns: turns.count, steps: steps.count };
  });
}
