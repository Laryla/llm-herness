import { randomUUID } from "node:crypto";

import {
  bindAgentResource,
  createAgent,
  createAgentRunContext,
  type AgentEvent,
  type AgentRun,
  type AgentRunContext,
} from "@llm-harness/agent-runtime";
import {
  API_VERSION,
  serverEventSchema,
  type ClientCommand,
  type ContractError,
  type ServerEvent,
} from "@llm-harness/contracts";
import { createOpenAIModel } from "@llm-harness/model-runtime/openai";
import type { ModelMessage } from "@llm-harness/model-runtime";
import type { LanguageModel } from "@llm-harness/model-runtime";

import type { PersistenceClient } from "../../infrastructure/database/database.js";
import { Prisma } from "../../infrastructure/database/generated/sqlite/client.js";
import type { ModelSecretStores } from "../models/model-profile-service.js";
import { ToolRegistryError } from "../tools/tool-registry.js";
import type { ToolRegistry } from "../tools/tool-registry.js";
import { workspacePathResourceKey } from "../tools/tool-resources.js";
import {
  serializeConversation,
  serializeStep,
  serializeTurn,
} from "../conversations/conversation-serialization.js";
import {
  RuntimeGatewayError,
  type RuntimeEventListener,
  type RuntimeGateway,
} from "./runtime-gateway.js";

type RuntimeCommand = Exclude<ClientCommand, { type: "runtime.subscribe" }>;
type TurnCreateCommand = Extract<RuntimeCommand, { type: "turn.create" }>;
type RunMessage = Exclude<ModelMessage, { role: "system" }>;
type ServerEventInput = ServerEvent extends infer Event
  ? Event extends ServerEvent
    ? Omit<Event, "apiVersion" | "eventId" | "sequence" | "occurredAt">
    : never
  : never;

export interface RuntimeLogger {
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
}

const silentLogger: RuntimeLogger = {
  info: () => undefined,
  warn: () => undefined,
};

interface ActiveTurn {
  readonly conversationId: string;
  readonly turnId: string;
  readonly context: AgentRunContext;
  readonly run: AgentRun;
  readonly titleModel: LanguageModel;
  readonly initialUserMessage: string;
  readonly shouldGenerateTitle: boolean;
  nextMessageSequence: number;
  readonly stepText: Map<string, string>;
  readonly stepToolExecutions: Map<string, Array<Record<string, unknown>>>;
  readonly pendingToolConfirmations: Map<string, string>;
}

/**
 * Server 中心化的 Agent Runtime Gateway。
 * WebSocket 断开不会取消这里持有的 Run；数据库是 Turn/Step 的权威状态来源。
 */
export class AgentRuntimeGateway implements RuntimeGateway {
  private readonly listeners = new Set<RuntimeEventListener>();
  private readonly eventHistory: ServerEvent[] = [];
  private readonly activeByConversation = new Map<string, ActiveTurn>();
  private readonly activeByTurn = new Map<string, ActiveTurn>();
  private sequence = 0;

  constructor(
    private readonly client: PersistenceClient,
    private readonly stores: ModelSecretStores,
    private readonly toolRegistry: ToolRegistry,
    private readonly maxSteps = 50,
    private readonly logger: RuntimeLogger = silentLogger,
  ) {}

  subscribe(afterSequence: number, listener: RuntimeEventListener): () => void {
    for (const event of this.eventHistory) {
      if (event.sequence > afterSequence) {
        listener(event);
      }
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async dispatch(command: RuntimeCommand): Promise<void> {
    switch (command.type) {
      case "turn.create":
        await this.createTurn(command);
        return;
      case "turn.cancel":
        this.cancelTurn(command.conversationId, command.turnId);
        return;
      case "turn.steer":
        this.steerTurn(command.conversationId, command.turnId, command.content);
        return;
      case "queued_message.create":
      case "queued_message.update":
      case "queued_message.delete":
      case "queued_message.reorder":
        throw new RuntimeGatewayError(
          "queued_messages_not_implemented",
          "Queued Message 将在 Conversation 队列模块中实现",
        );
      case "tool.confirm": {
        const active = this.requireActiveTurn(command.conversationId, command.turnId);
        if (
          active.pendingToolConfirmations.get(command.toolCallId) !== command.stepId ||
          !active.run.confirmTool(command.toolCallId)
        ) {
          throw new RuntimeGatewayError(
            "tool_confirmation_not_pending",
            "该 Tool Call 当前不在等待确认",
            false,
            command.toolCallId,
          );
        }
        return;
      }
      case "tool.reject": {
        const active = this.requireActiveTurn(command.conversationId, command.turnId);
        if (
          active.pendingToolConfirmations.get(command.toolCallId) !== command.stepId ||
          !active.run.rejectTool(command.toolCallId)
        ) {
          throw new RuntimeGatewayError(
            "tool_confirmation_not_pending",
            "该 Tool Call 当前不在等待确认",
            false,
            command.toolCallId,
          );
        }
        return;
      }
    }
  }

  private async createTurn(command: TurnCreateCommand): Promise<void> {
    if (this.activeByConversation.has(command.conversationId)) {
      throw new RuntimeGatewayError(
        "conversation_busy",
        "该 Conversation 已有正在运行的 Turn",
        false,
        command.conversationId,
      );
    }
    let boundTools;
    try {
      boundTools = this.toolRegistry.bind(command.toolSelection.toolIds);
    } catch (error) {
      if (error instanceof ToolRegistryError && error.code === "tool_not_found") {
        throw new RuntimeGatewayError(error.code, error.message);
      }
      throw error;
    }
    const conversation = await this.client.conversation.findUnique({
      where: { id: command.conversationId },
      include: { workspace: true },
    });
    if (!conversation) {
      throw new RuntimeGatewayError(
        "conversation_not_found",
        "Conversation 不存在",
        false,
        command.conversationId,
      );
    }
    if (conversation.workspace.status !== "available") {
      throw new RuntimeGatewayError(
        "workspace_unavailable",
        "Conversation 所属 Workspace 当前不可用",
        false,
        conversation.workspaceId,
      );
    }
    const modelConfiguration = await this.resolveModel(command);
    const previousMessages = await this.client.message.findMany({
      where: { conversationId: command.conversationId },
      orderBy: [{ sequence: "asc" }, { id: "asc" }],
    });
    const previousTurnCount = await this.client.turn.count({
      where: { conversationId: conversation.id },
    });
    const nextMessageSequence = (previousMessages.at(-1)?.sequence ?? 0) + 1;
    const turnId = createEntityId("turn");
    const now = new Date();
    const record = await this.client.$transaction(async (transaction) => {
      const turn = await transaction.turn.create({
        data: {
          id: turnId,
          conversationId: conversation.id,
          workspaceId: conversation.workspaceId,
          status: "queued",
          userMessage: command.content,
          modelSelectionSnapshot: command.modelSelection,
          modelParametersSnapshot: command.modelParameters,
          toolBindingSnapshot:
            boundTools.snapshot as unknown as Prisma.InputJsonValue,
          instructionsSnapshot: conversation.instructions,
          maxIterations: this.maxSteps,
        },
      });
      await transaction.message.create({
        data: {
          id: createEntityId("message"),
          conversationId: conversation.id,
          turnId,
          sequence: nextMessageSequence,
          role: "user",
          source: "turn",
          content: command.content,
        },
      });
      return turn;
    });
    this.publish({
      type: "turn.created",
      conversationId: conversation.id,
      turn: serializeTurn(record),
    });

    const model = createOpenAIModel(modelConfiguration, { logger: this.logger });
    const agent = createAgent({
      model,
      tools: boundTools.tools,
      ...(conversation.instructions.length > 0
        ? {
            systemMessage: {
              role: "system" as const,
              content: conversation.instructions,
            },
          }
        : {}),
      maxSteps: this.maxSteps,
      idGenerator: () => createEntityId("step"),
      logger: this.logger,
    });
    const context = createAgentRunContext({
      runId: turnId,
      resources: [
        bindAgentResource(workspacePathResourceKey, conversation.workspace.path),
      ],
      metadata: {
        conversationId: conversation.id,
        workspacePath: conversation.workspace.path,
      },
    });
    const run = agent.run({
      context,
      messages: [
        ...previousMessages.flatMap((record) => toModelMessage(record)),
        { role: "user" as const, content: command.content },
      ],
      parameters: command.modelParameters,
    });
    const active: ActiveTurn = {
      conversationId: conversation.id,
      turnId,
      context,
      run,
      titleModel: model,
      initialUserMessage: command.content,
      shouldGenerateTitle:
        conversation.titleSource === "temporary" && previousTurnCount === 0,
      nextMessageSequence: nextMessageSequence + 1,
      stepText: new Map(),
      stepToolExecutions: new Map(),
      pendingToolConfirmations: new Map(),
    };
    this.activeByConversation.set(conversation.id, active);
    this.activeByTurn.set(turnId, active);
    await this.client.turn.update({
      where: { id: turnId },
      data: { status: "running", startedAt: now },
    });
    this.publish({
      type: "turn.status_changed",
      conversationId: conversation.id,
      turnId,
      status: "running",
    });
    this.logger.info(
      { conversationId: conversation.id, modelId: command.modelSelection.modelName, turnId },
      "Turn Runtime 已启动",
    );
    void this.observeRun(active);
  }

  private cancelTurn(conversationId: string, turnId: string): void {
    const active = this.requireActiveTurn(conversationId, turnId);
    active.run.abort("用户取消 Turn");
  }

  private steerTurn(conversationId: string, turnId: string, content: string): void {
    const active = this.requireActiveTurn(conversationId, turnId);
    const messageId = createEntityId("message");
    const result = active.context.enqueueMessage({ id: messageId, content });
    if (!result.accepted) {
      throw new RuntimeGatewayError("turn_not_running", "Turn 已经结束", false, turnId);
    }
  }

  private requireActiveTurn(conversationId: string, turnId: string): ActiveTurn {
    const active = this.activeByTurn.get(turnId);
    if (!active || active.conversationId !== conversationId) {
      throw new RuntimeGatewayError("turn_not_running", "找不到正在运行的 Turn", false, turnId);
    }
    return active;
  }

  private async resolveModel(command: TurnCreateCommand) {
    const entry = await this.client.modelCatalogEntry.findFirst({
      where: {
        profileId: command.modelSelection.profileId,
        modelName: command.modelSelection.modelName,
      },
      include: { profile: true },
    });
    if (!entry) {
      throw new RuntimeGatewayError("model_not_found", "选择的模型不在 Model Catalog 中");
    }
    const source = entry.profile.secretSource as "local" | "keychain" | "environment";
    const apiKey = await this.stores[source].get(entry.profile.secretReference);
    if (apiKey === null) {
      throw new RuntimeGatewayError("secret_not_found", "找不到模型密钥");
    }
    return {
      apiKey,
      baseUrl: entry.profile.baseUrl,
      modelId: entry.modelName,
    };
  }

  private async observeRun(active: ActiveTurn): Promise<void> {
    try {
      for await (const event of active.run.events) {
        await this.persistAndPublishAgentEvent(active, event);
      }
      const result = await active.run.result;
      if (result.status === "completed" && active.shouldGenerateTitle) {
        await this.generateConversationTitle(active, result.finalText, result.stepCount);
      }
      const status =
        result.status === "stopped" ? "limit_reached" : result.status;
      await this.client.turn.update({
        where: { id: active.turnId },
        data: {
          status,
          completedAt: new Date(),
          ...(result.error
            ? { error: result.error as unknown as Prisma.InputJsonValue }
            : {}),
        },
      });
      this.publish({
        type: "turn.status_changed",
        conversationId: active.conversationId,
        turnId: active.turnId,
        status,
      });
    } catch (error) {
      const contractError = runtimePersistenceError();
      await this.client.turn
        .update({
          where: { id: active.turnId },
          data: {
            status: "failed",
            completedAt: new Date(),
            error: contractError as unknown as Prisma.InputJsonValue,
          },
        })
        .catch(() => undefined);
      this.publish({
        type: "runtime.error",
        entityId: active.turnId,
        error: contractError,
      });
      this.publish({
        type: "turn.status_changed",
        conversationId: active.conversationId,
        turnId: active.turnId,
        status: "failed",
      });
      this.logger.warn({ err: error, turnId: active.turnId }, "Turn Runtime 持久化失败");
    } finally {
      this.activeByConversation.delete(active.conversationId);
      this.activeByTurn.delete(active.turnId);
    }
  }

  /** 标题生成是非关键 Step；失败只记录 Step，不改变主 Turn 的成功结果。 */
  private async generateConversationTitle(
    active: ActiveTurn,
    assistantText: string,
    completedStepCount: number,
  ): Promise<void> {
    const stepId = createEntityId("step");
    const sequence = completedStepCount + 1;
    const startedAt = new Date();
    const step = await this.client.step.create({
      data: {
        id: stepId,
        turnId: active.turnId,
        sequence,
        kind: "title_generation",
        status: "running",
        input: { source: "first_turn" },
        startedAt,
      },
    });
    this.publish({
      type: "step.created",
      conversationId: active.conversationId,
      turnId: active.turnId,
      step: serializeStep(step),
    });
    try {
      let title = "";
      for await (const event of active.titleModel.stream({
        messages: [
          {
            role: "system",
            content:
              "根据用户问题和助手回答生成一个简洁的中文对话标题。只输出标题，不要引号，不要解释，最多30个字符。",
          },
          {
            role: "user",
            content: `用户问题：${active.initialUserMessage}\n\n助手回答：${assistantText}`,
          },
        ],
      })) {
        if (event.type === "text_delta") {
          title += event.delta;
          this.publish({
            type: "step.content_delta",
            conversationId: active.conversationId,
            turnId: active.turnId,
            stepId,
            delta: event.delta,
          });
        }
      }
      const normalizedTitle = normalizeGeneratedTitle(title);
      const completedAt = new Date();
      const [, conversation] = await this.client.$transaction([
        this.client.step.update({
          where: { id: stepId },
          data: {
            status: "completed",
            output: { title: normalizedTitle },
            completedAt,
          },
        }),
        this.client.conversation.update({
          where: { id: active.conversationId },
          data: { title: normalizedTitle, titleSource: "generated" },
        }),
      ]);
      this.publish({
        type: "step.status_changed",
        conversationId: active.conversationId,
        turnId: active.turnId,
        stepId,
        status: "completed",
      });
      this.publish({
        type: "conversation.title_changed",
        conversationId: active.conversationId,
        conversation: serializeConversation(conversation),
      });
    } catch (error) {
      const completedAt = new Date();
      await this.client.step.update({
        where: { id: step.id },
        data: {
          status: "failed",
          completedAt,
          error: {
            code: "title_generation_failed",
            message: "Conversation 标题生成失败",
            retryable: false,
          },
        },
      });
      this.publish({
        type: "step.status_changed",
        conversationId: active.conversationId,
        turnId: active.turnId,
        stepId,
        status: "failed",
      });
      this.logger.warn(
        { err: error, conversationId: active.conversationId, turnId: active.turnId },
        "Conversation 标题生成失败",
      );
    }
  }

  private async persistAndPublishAgentEvent(
    active: ActiveTurn,
    event: AgentEvent,
  ): Promise<void> {
    switch (event.type) {
      case "message.applied":
        await this.client.message.create({
          data: {
            id: event.messageId,
            conversationId: active.conversationId,
            turnId: active.turnId,
            sequence: active.nextMessageSequence++,
            role: "user",
            source: "steering",
            content: event.content,
          },
        });
        return;
      case "step.started": {
        const now = new Date();
        const step = await this.client.step.create({
          data: {
            id: event.stepId,
            turnId: active.turnId,
            iterationIndex: event.stepIndex,
            sequence: event.stepIndex,
            kind: "model",
            status: "running",
            input: { stepIndex: event.stepIndex },
            startedAt: now,
          },
        });
        active.stepText.set(event.stepId, "");
        active.stepToolExecutions.set(event.stepId, []);
        this.publish({
          type: "step.created",
          conversationId: active.conversationId,
          turnId: active.turnId,
          step: {
            id: step.id,
            turnId: step.turnId,
            sequence: step.sequence,
            kind: "model",
            status: "running",
            input: { stepIndex: event.stepIndex },
            startedAt: now.toISOString(),
            createdAt: step.createdAt.toISOString(),
            updatedAt: step.updatedAt.toISOString(),
          },
        });
        return;
      }
      case "model.text.delta": {
        const content = (active.stepText.get(event.stepId) ?? "") + event.delta;
        active.stepText.set(event.stepId, content);
        await this.client.step.update({
          where: { id: event.stepId },
          data: { output: { content } },
        });
        this.publish({
          type: "step.content_delta",
          conversationId: active.conversationId,
          turnId: active.turnId,
          stepId: event.stepId,
          delta: event.delta,
        });
        return;
      }
      case "tool.confirmation.requested": {
        let toolArguments: unknown;
        try {
          toolArguments = JSON.parse(event.toolCall.arguments) as unknown;
        } catch {
          toolArguments = event.toolCall.arguments;
        }
        active.pendingToolConfirmations.set(event.toolCall.id, event.stepId);
        await this.client.toolConfirmation.create({
          data: {
            id: createEntityId("confirmation"),
            stepId: event.stepId,
            toolCallId: event.toolCall.id,
            toolId: event.toolId,
            status: "pending",
            arguments:
              toolArguments === null
                ? Prisma.JsonNull
                : (toolArguments as Prisma.InputJsonValue),
          },
        });
        this.publish({
          type: "tool.confirmation_requested",
          conversationId: active.conversationId,
          turnId: active.turnId,
          stepId: event.stepId,
          toolId: event.toolId,
          toolCallId: event.toolCall.id,
          arguments: toolArguments,
        });
        return;
      }
      case "tool.confirmation.resolved":
        active.pendingToolConfirmations.delete(event.toolCall.id);
        await this.client.toolConfirmation.update({
          where: {
            stepId_toolCallId: {
              stepId: event.stepId,
              toolCallId: event.toolCall.id,
            },
          },
          data: { status: event.decision, decidedAt: new Date() },
        });
        return;
      case "tool.completed": {
        const executions = active.stepToolExecutions.get(event.stepId) ?? [];
        executions.push({
          toolId: event.toolId,
          toolCallId: event.toolCall.id,
          modelName: event.toolCall.name,
          arguments: event.toolCall.arguments,
          result: event.result,
        });
        active.stepToolExecutions.set(event.stepId, executions);
        return;
      }
      case "step.completed": {
        const completedAt = new Date();
        const content = active.stepText.get(event.stepId) ?? "";
        await this.client.$transaction(async (transaction) => {
          await transaction.step.update({
            where: { id: event.stepId },
            data: {
              status: "completed",
              output: {
                content,
                toolCallCount: event.toolCallCount,
                toolExecutions: active.stepToolExecutions.get(event.stepId) ?? [],
              } as unknown as Prisma.InputJsonValue,
              completedAt,
              ...(event.usage
                ? { usage: event.usage as unknown as Prisma.InputJsonValue }
                : {}),
            },
          });
          if (content.length > 0) {
            await transaction.message.create({
              data: {
                id: createEntityId("message"),
                conversationId: active.conversationId,
                turnId: active.turnId,
                stepId: event.stepId,
                sequence: active.nextMessageSequence++,
                role: "assistant",
                content,
              },
            });
          }
        });
        this.publish({
          type: "step.status_changed",
          conversationId: active.conversationId,
          turnId: active.turnId,
          stepId: event.stepId,
          status: "completed",
        });
        return;
      }
      default:
        return;
    }
  }

  private publish(
    event: ServerEventInput,
  ): void {
    this.sequence += 1;
    const complete = serverEventSchema.parse({
      ...event,
      apiVersion: API_VERSION,
      eventId: createEntityId("event"),
      sequence: this.sequence,
      occurredAt: new Date().toISOString(),
    });
    this.eventHistory.push(complete);
    if (this.eventHistory.length > 1_000) {
      this.eventHistory.shift();
    }
    for (const listener of this.listeners) {
      listener(complete);
    }
  }
}

function createEntityId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function normalizeGeneratedTitle(value: string): string {
  const normalized = value.trim().replace(/^["'“”]+|["'“”]+$/g, "");
  if (normalized.length === 0) {
    throw new Error("模型返回了空标题");
  }
  return Array.from(normalized).slice(0, 30).join("");
}

function toModelMessage(record: {
  role: string;
  content: string;
  toolCallId: string | null;
}): RunMessage[] {
  if (record.role === "user") {
    return [{ role: "user" as const, content: record.content }];
  }
  if (record.role === "assistant") {
    return [{ role: "assistant" as const, content: record.content }];
  }
  if (record.role === "tool" && record.toolCallId) {
    return [
      {
        role: "tool" as const,
        toolCallId: record.toolCallId,
        content: record.content,
      },
    ];
  }
  return [];
}

function runtimePersistenceError(): ContractError {
  return {
    code: "runtime_persistence_failed",
    message: "Runtime 持久化失败",
    retryable: false,
  };
}
