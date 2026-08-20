import { z } from "zod";

import { entityIdSchema, isoDateTimeSchema } from "./common.js";
import { iterationSchema, stepSchema, turnSchema } from "./conversation.js";

const messageBaseShape = {
  id: entityIdSchema,
  conversationId: entityIdSchema,
  turnId: entityIdSchema,
  sequence: z.number().int().positive(),
  content: z.string(),
  createdAt: isoDateTimeSchema,
};

export const userMessageSchema = z
  .object({
    ...messageBaseShape,
    role: z.literal("user"),
    source: z.enum(["turn", "steering"]),
  })
  .strict();

export const assistantMessageSchema = z
  .object({ ...messageBaseShape, role: z.literal("assistant"), stepId: entityIdSchema })
  .strict();

export const toolMessageSchema = z
  .object({
    ...messageBaseShape,
    role: z.literal("tool"),
    stepId: entityIdSchema,
    toolCallId: z.string().min(1),
    toolId: entityIdSchema,
  })
  .strict();

export const messageSchema = z.discriminatedUnion("role", [
  userMessageSchema,
  assistantMessageSchema,
  toolMessageSchema,
]);

export const queuedMessageStatusSchema = z.enum([
  "queued",
  "paused",
  "processing",
]);

export const queuedMessageSchema = z
  .object({
    id: entityIdSchema,
    conversationId: entityIdSchema,
    content: z.string().min(1),
    position: z.number().int().nonnegative(),
    status: queuedMessageStatusSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const steeringMessageStatusSchema = z.enum([
  "accepted",
  "applied",
  "queued",
]);

export const steeringMessageSchema = z
  .object({
    id: entityIdSchema,
    conversationId: entityIdSchema,
    turnId: entityIdSchema,
    content: z.string().min(1),
    status: steeringMessageStatusSchema,
    createdAt: isoDateTimeSchema,
    appliedAt: isoDateTimeSchema.optional(),
  })
  .strict();

export const traceSchema = z
  .object({
    turn: turnSchema,
    iterations: z.array(iterationSchema),
    steps: z.array(stepSchema),
    steeringMessages: z.array(steeringMessageSchema),
  })
  .strict();

export type Message = z.infer<typeof messageSchema>;
export type QueuedMessageStatus = z.infer<typeof queuedMessageStatusSchema>;
export type QueuedMessage = z.infer<typeof queuedMessageSchema>;
export type SteeringMessageStatus = z.infer<
  typeof steeringMessageStatusSchema
>;
export type SteeringMessage = z.infer<typeof steeringMessageSchema>;
export type Trace = z.infer<typeof traceSchema>;
