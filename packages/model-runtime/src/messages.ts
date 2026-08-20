/** 模型运行时使用的标准消息；供应商 Adapter 负责转换成各自的协议格式。 */
export interface SystemMessage {
  readonly role: "system";
  readonly content: string;
}

export interface UserMessage {
  readonly role: "user";
  readonly content: string;
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  /** 保留模型生成的原始 JSON 字符串，由 Agent Runtime 在执行工具前校验。 */
  readonly arguments: string;
}

export interface AssistantMessage {
  readonly role: "assistant";
  readonly content: string | null;
  readonly toolCalls?: readonly ToolCall[];
}

export interface ToolResultMessage {
  readonly role: "tool";
  readonly toolCallId: string;
  /** Tool Result 已序列化的文本内容。 */
  readonly content: string;
}

export type ModelMessage =
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ToolResultMessage;
