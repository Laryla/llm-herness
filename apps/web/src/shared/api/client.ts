import { API_VERSION, errorEnvelopeSchema, type ErrorEnvelope } from "@llm-harness/contracts";
import { z } from "zod";

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly envelope: ErrorEnvelope,
  ) {
    super(envelope.error.message);
    this.name = "ApiClientError";
  }
}

const successEnvelopeSchema = <T extends z.ZodType>(data: T) =>
  z.object({ apiVersion: z.literal(API_VERSION), data }).strict();

/** 所有 REST 功能共用的契约校验客户端，拒绝静默接受漂移的响应。 */
export async function requestApi<T extends z.ZodType>(
  path: string,
  schema: T,
  init?: RequestInit,
): Promise<z.infer<T>> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new ApiClientError(response.status, errorEnvelopeSchema.parse(payload));
  }
  const envelope = successEnvelopeSchema(schema).parse(payload) as {
    data: z.infer<T>;
  };
  return envelope.data;
}
