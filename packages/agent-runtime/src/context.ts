import { randomUUID } from "node:crypto";

import type { UserMessage } from "@llm-harness/model-runtime";

export interface AgentResourceKey<T> {
  readonly name: string;
  readonly token: symbol;
  /** 仅用于在编译期保留资源值类型。 */
  readonly __valueType?: T;
}

export interface AgentResourceBinding {
  readonly key: AgentResourceKey<unknown>;
  readonly value: unknown;
}

export function createAgentResourceKey<T>(name: string): AgentResourceKey<T> {
  return Object.freeze({ name, token: Symbol(name) });
}

export function bindAgentResource<T>(
  key: AgentResourceKey<T>,
  value: T,
): AgentResourceBinding {
  return { key, value };
}

export interface SteeringMessage extends UserMessage {
  readonly id: string;
}

export type EnqueueMessageResult =
  | { readonly accepted: true; readonly messageId: string }
  | { readonly accepted: false; readonly reason: "run_closed" };

export interface AgentRunContext {
  readonly runId: string;
  readonly signal: AbortSignal;
  readonly metadata: Readonly<Record<string, unknown>>;
  enqueueMessage(message: { readonly id?: string; readonly content: string }): EnqueueMessageResult;
  getResource<T>(key: AgentResourceKey<T>): T | undefined;
}

export interface CreateAgentRunContextOptions {
  readonly runId: string;
  readonly signal?: AbortSignal;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly resources?: readonly AgentResourceBinding[];
  readonly idGenerator?: () => string;
}

interface MutableContextState {
  readonly controller: AbortController;
  readonly pendingMessages: SteeringMessage[];
  readonly resources: Map<symbol, unknown>;
  active: boolean;
  detachExternalSignal?: () => void;
}

const contextStates = new WeakMap<AgentRunContext, MutableContextState>();

/** 每个 Context 只服务一次 Run；结束后消息入口会自动关闭。 */
export function createAgentRunContext(
  options: CreateAgentRunContextOptions,
): AgentRunContext {
  if (options.runId.trim().length === 0) {
    throw new Error("runId 不能为空");
  }
  const controller = new AbortController();
  const state: MutableContextState = {
    active: true,
    controller,
    pendingMessages: [],
    resources: new Map(
      options.resources?.map(({ key, value }) => [key.token, value]) ?? [],
    ),
  };
  const generateId = options.idGenerator ?? randomUUID;
  const context: AgentRunContext = Object.freeze({
    runId: options.runId,
    signal: controller.signal,
    metadata: Object.freeze({ ...(options.metadata ?? {}) }),
    enqueueMessage(message: { readonly id?: string; readonly content: string }): EnqueueMessageResult {
      if (!state.active) {
        return { accepted: false, reason: "run_closed" };
      }
      const content = message.content.trim();
      if (content.length === 0) {
        throw new Error("强制消息内容不能为空");
      }
      const messageId = message.id ?? generateId();
      state.pendingMessages.push({ id: messageId, role: "user", content });
      return { accepted: true, messageId };
    },
    getResource<T>(key: AgentResourceKey<T>): T | undefined {
      return state.resources.get(key.token) as T | undefined;
    },
  });
  contextStates.set(context, state);

  if (options.signal) {
    const abortFromExternalSignal = () => controller.abort(options.signal?.reason);
    if (options.signal.aborted) {
      abortFromExternalSignal();
    } else {
      options.signal.addEventListener("abort", abortFromExternalSignal, { once: true });
      state.detachExternalSignal = () =>
        options.signal?.removeEventListener("abort", abortFromExternalSignal);
    }
  }
  return context;
}

export function consumePendingMessages(context: AgentRunContext): SteeringMessage[] {
  const state = requireContextState(context);
  return state.pendingMessages.splice(0);
}

export function hasPendingMessages(context: AgentRunContext): boolean {
  return requireContextState(context).pendingMessages.length > 0;
}

export function abortRunContext(context: AgentRunContext, reason?: string): void {
  requireContextState(context).controller.abort(reason);
}

export function closeRunContext(context: AgentRunContext): void {
  const state = requireContextState(context);
  state.active = false;
  state.detachExternalSignal?.();
}

function requireContextState(context: AgentRunContext): MutableContextState {
  const state = contextStates.get(context);
  if (!state) {
    throw new Error("AgentRunContext 必须通过 createAgentRunContext 创建");
  }
  return state;
}
