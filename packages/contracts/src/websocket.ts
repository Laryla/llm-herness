import { z } from "zod";

import {
  apiVersionSchema,
  contractErrorSchema,
  entityIdSchema,
  isoDateTimeSchema,
} from "./common.js";
import {
  modelParametersSchema,
  modelSelectionSchema,
} from "./model.js";
import {
  conversationSchema,
  stepSchema,
  stepStatusSchema,
  turnSchema,
  turnStatusSchema,
} from "./conversation.js";
import { queuedMessageSchema, steeringMessageSchema } from "./message.js";
import { toolSelectionSchema } from "./tool.js";

const commandBaseShape = {
  apiVersion: apiVersionSchema,
  commandId: entityIdSchema,
};

export const clientCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...commandBaseShape,
      type: z.literal("runtime.subscribe"),
      afterSequence: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      ...commandBaseShape,
      type: z.literal("turn.create"),
      conversationId: entityIdSchema,
      content: z.string().min(1),
      modelSelection: modelSelectionSchema,
      toolSelection: toolSelectionSchema,
      modelParameters: modelParametersSchema,
    })
    .strict(),
  z
    .object({
      ...commandBaseShape,
      type: z.literal("turn.cancel"),
      conversationId: entityIdSchema,
      turnId: entityIdSchema,
    })
    .strict(),
  z
    .object({
      ...commandBaseShape,
      type: z.enum(["tool.confirm", "tool.reject"]),
      conversationId: entityIdSchema,
      turnId: entityIdSchema,
      stepId: entityIdSchema,
      toolCallId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      ...commandBaseShape,
      type: z.literal("queued_message.create"),
      conversationId: entityIdSchema,
      content: z.string().min(1),
    })
    .strict(),
  z
    .object({
      ...commandBaseShape,
      type: z.literal("queued_message.update"),
      conversationId: entityIdSchema,
      queuedMessageId: entityIdSchema,
      content: z.string().min(1),
    })
    .strict(),
  z
    .object({
      ...commandBaseShape,
      type: z.literal("queued_message.delete"),
      conversationId: entityIdSchema,
      queuedMessageId: entityIdSchema,
    })
    .strict(),
  z
    .object({
      ...commandBaseShape,
      type: z.literal("queued_message.reorder"),
      conversationId: entityIdSchema,
      queuedMessageIds: z.array(entityIdSchema),
    })
    .strict(),
  z
    .object({
      ...commandBaseShape,
      type: z.literal("turn.steer"),
      conversationId: entityIdSchema,
      turnId: entityIdSchema,
      content: z.string().min(1),
    })
    .strict(),
]);

const eventBaseShape = {
  apiVersion: apiVersionSchema,
  eventId: entityIdSchema,
  sequence: z.number().int().positive(),
  occurredAt: isoDateTimeSchema,
};

export const serverEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...eventBaseShape,
      type: z.literal("turn.created"),
      conversationId: entityIdSchema,
      turn: turnSchema,
    })
    .strict(),
  z
    .object({
      ...eventBaseShape,
      type: z.literal("turn.status_changed"),
      conversationId: entityIdSchema,
      turnId: entityIdSchema,
      status: turnStatusSchema,
    })
    .strict(),
  z
    .object({
      ...eventBaseShape,
      type: z.literal("step.created"),
      conversationId: entityIdSchema,
      turnId: entityIdSchema,
      step: stepSchema,
    })
    .strict(),
  z
    .object({
      ...eventBaseShape,
      type: z.literal("step.status_changed"),
      conversationId: entityIdSchema,
      turnId: entityIdSchema,
      stepId: entityIdSchema,
      status: stepStatusSchema,
    })
    .strict(),
  z
    .object({
      ...eventBaseShape,
      type: z.literal("step.content_delta"),
      conversationId: entityIdSchema,
      turnId: entityIdSchema,
      stepId: entityIdSchema,
      delta: z.string().min(1),
    })
    .strict(),
  z
    .object({
      ...eventBaseShape,
      type: z.literal("tool.confirmation_requested"),
      conversationId: entityIdSchema,
      turnId: entityIdSchema,
      stepId: entityIdSchema,
      toolId: entityIdSchema,
      toolCallId: z.string().min(1),
      arguments: z.unknown(),
    })
    .strict(),
  z
    .object({
      ...eventBaseShape,
      type: z.literal("queued_message.changed"),
      conversationId: entityIdSchema,
      queuedMessage: queuedMessageSchema,
      change: z.enum(["upserted", "deleted"]),
    })
    .strict(),
  z
    .object({
      ...eventBaseShape,
      type: z.literal("steering_message.accepted"),
      conversationId: entityIdSchema,
      turnId: entityIdSchema,
      steeringMessage: steeringMessageSchema,
    })
    .strict(),
  z
    .object({
      ...eventBaseShape,
      type: z.literal("current_workspace.changed"),
      workspaceId: entityIdSchema,
    })
    .strict(),
  z
    .object({
      ...eventBaseShape,
      type: z.literal("current_model_selection.changed"),
      selection: modelSelectionSchema.nullable(),
    })
    .strict(),
  z
    .object({
      ...eventBaseShape,
      type: z.literal("current_tool_selection.changed"),
      selection: toolSelectionSchema,
    })
    .strict(),
  z
    .object({
      ...eventBaseShape,
      type: z.literal("conversation.title_changed"),
      conversationId: entityIdSchema,
      conversation: conversationSchema,
    })
    .strict(),
  z
    .object({
      ...eventBaseShape,
      type: z.literal("runtime.error"),
      entityId: entityIdSchema.optional(),
      error: contractErrorSchema,
    })
    .strict(),
]);

export type ClientCommand = z.infer<typeof clientCommandSchema>;
export type ServerEvent = z.infer<typeof serverEventSchema>;
