import { z } from "zod";

import {
  contractErrorSchema,
  entityIdSchema,
  isoDateTimeSchema,
} from "./common.js";
import { modelParametersSchema, modelSelectionSchema } from "./model.js";
import { toolBindingSnapshotSchema } from "./tool.js";

export const conversationSchema = z
  .object({
    id: entityIdSchema,
    workspaceId: entityIdSchema,
    title: z.string().min(1).max(200),
    titleSource: z.enum(["temporary", "generated", "user"]),
    instructions: z.string().max(100_000),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const turnStatusSchema = z.enum([
  "queued",
  "running",
  "awaiting_confirmation",
  "completed",
  "limit_reached",
  "failed",
  "cancelled",
  "interrupted",
]);

export const turnSchema = z
  .object({
    id: entityIdSchema,
    conversationId: entityIdSchema,
    workspaceId: entityIdSchema,
    status: turnStatusSchema,
    userMessage: z.string().min(1),
    modelSelection: modelSelectionSchema,
    modelParameters: modelParametersSchema,
    toolBinding: toolBindingSnapshotSchema,
    instructions: z.string().max(100_000),
    maxIterations: z.number().int().min(1).max(100),
    error: contractErrorSchema.optional(),
    createdAt: isoDateTimeSchema,
    startedAt: isoDateTimeSchema.optional(),
    completedAt: isoDateTimeSchema.optional(),
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const iterationStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "cancelled",
  "interrupted",
]);

export const iterationSchema = z
  .object({
    id: entityIdSchema,
    turnId: entityIdSchema,
    index: z.number().int().positive(),
    status: iterationStatusSchema,
    createdAt: isoDateTimeSchema,
    completedAt: isoDateTimeSchema.optional(),
  })
  .strict();

export const stepStatusSchema = z.enum([
  "pending",
  "running",
  "awaiting_confirmation",
  "completed",
  "failed",
  "rejected",
  "cancelled",
  "interrupted",
]);

export const tokenUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    ({ inputTokens, outputTokens, totalTokens }) =>
      inputTokens + outputTokens === totalTokens,
    { message: "totalTokens 必须等于输入与输出 Token 之和" },
  );

const stepBaseShape = {
  id: entityIdSchema,
  turnId: entityIdSchema,
  iterationId: entityIdSchema.optional(),
  sequence: z.number().int().positive(),
  status: stepStatusSchema,
  input: z.unknown(),
  output: z.unknown().optional(),
  error: contractErrorSchema.optional(),
  usage: tokenUsageSchema.optional(),
  startedAt: isoDateTimeSchema.optional(),
  completedAt: isoDateTimeSchema.optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
};

export const modelStepSchema = z
  .object({ ...stepBaseShape, kind: z.literal("model") })
  .strict();
export const toolStepSchema = z
  .object({ ...stepBaseShape, kind: z.literal("tool") })
  .strict();
export const titleGenerationStepSchema = z
  .object({ ...stepBaseShape, kind: z.literal("title_generation") })
  .strict();

export const stepSchema = z.discriminatedUnion("kind", [
  modelStepSchema,
  toolStepSchema,
  titleGenerationStepSchema,
]);

export type Conversation = z.infer<typeof conversationSchema>;
export type TurnStatus = z.infer<typeof turnStatusSchema>;
export type Turn = z.infer<typeof turnSchema>;
export type IterationStatus = z.infer<typeof iterationStatusSchema>;
export type Iteration = z.infer<typeof iterationSchema>;
export type StepStatus = z.infer<typeof stepStatusSchema>;
export type TokenUsage = z.infer<typeof tokenUsageSchema>;
export type Step = z.infer<typeof stepSchema>;
