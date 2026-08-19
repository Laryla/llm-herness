import type {
  ContractError,
  Conversation,
  Message,
  Step,
  TokenUsage,
  Turn,
} from "@llm-harness/contracts";

/** 将数据库记录转换成跨 Client 使用的 Conversation 契约。 */
export function serializeConversation(record: {
  id: string;
  workspaceId: string;
  title: string;
  titleSource: string;
  instructions: string;
  createdAt: Date;
  updatedAt: Date;
}): Conversation {
  return {
    ...record,
    titleSource: record.titleSource as Conversation["titleSource"],
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** Turn 中的选择、参数、工具与 Instructions 都是创建时的不可变快照。 */
export function serializeTurn(record: {
  id: string;
  conversationId: string;
  workspaceId: string;
  status: string;
  userMessage: string;
  modelSelectionSnapshot: unknown;
  modelParametersSnapshot: unknown;
  toolBindingSnapshot: unknown;
  instructionsSnapshot: string;
  maxIterations: number;
  error: unknown;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
}): Turn {
  return {
    id: record.id,
    conversationId: record.conversationId,
    workspaceId: record.workspaceId,
    status: record.status as Turn["status"],
    userMessage: record.userMessage,
    modelSelection: record.modelSelectionSnapshot as Turn["modelSelection"],
    modelParameters: record.modelParametersSnapshot as Turn["modelParameters"],
    toolBinding: record.toolBindingSnapshot as Turn["toolBinding"],
    instructions: record.instructionsSnapshot,
    maxIterations: record.maxIterations,
    ...(record.error ? { error: record.error as ContractError } : {}),
    createdAt: record.createdAt.toISOString(),
    ...(record.startedAt ? { startedAt: record.startedAt.toISOString() } : {}),
    ...(record.completedAt ? { completedAt: record.completedAt.toISOString() } : {}),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function iterationId(turnId: string, index: number): string {
  return `iteration_${turnId.slice("turn_".length)}_${index}`;
}

/** Step 是一次模型调用及其工具执行的聚合记录。 */
export function serializeStep(record: {
  id: string;
  turnId: string;
  iterationIndex: number | null;
  sequence: number;
  kind: string;
  status: string;
  input: unknown;
  output: unknown;
  error: unknown;
  usage: unknown;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): Step {
  return {
    id: record.id,
    turnId: record.turnId,
    ...(record.iterationIndex
      ? { iterationId: iterationId(record.turnId, record.iterationIndex) }
      : {}),
    sequence: record.sequence,
    kind: record.kind as Step["kind"],
    status: record.status as Step["status"],
    input: record.input,
    ...(record.output !== null ? { output: record.output } : {}),
    ...(record.error ? { error: record.error as ContractError } : {}),
    ...(record.usage ? { usage: record.usage as TokenUsage } : {}),
    ...(record.startedAt ? { startedAt: record.startedAt.toISOString() } : {}),
    ...(record.completedAt ? { completedAt: record.completedAt.toISOString() } : {}),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function serializeMessage(record: {
  id: string;
  conversationId: string;
  turnId: string;
  stepId: string | null;
  sequence: number;
  role: string;
  source: string | null;
  content: string;
  toolCallId: string | null;
  toolId: string | null;
  createdAt: Date;
}): Message {
  const common = {
    id: record.id,
    conversationId: record.conversationId,
    turnId: record.turnId,
    sequence: record.sequence,
    content: record.content,
    createdAt: record.createdAt.toISOString(),
  };
  if (record.role === "user") {
    return {
      ...common,
      role: "user",
      source: record.source === "steering" ? "steering" : "turn",
    };
  }
  if (record.role === "assistant" && record.stepId) {
    return { ...common, role: "assistant", stepId: record.stepId };
  }
  if (
    record.role === "tool" &&
    record.stepId &&
    record.toolCallId &&
    record.toolId
  ) {
    return {
      ...common,
      role: "tool",
      stepId: record.stepId,
      toolCallId: record.toolCallId,
      toolId: record.toolId,
    };
  }
  throw new Error(`数据库中存在不完整的 Message：${record.id}`);
}
