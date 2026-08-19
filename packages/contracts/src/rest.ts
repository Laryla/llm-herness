import { z } from "zod";

import { apiVersionSchema, entityIdSchema } from "./common.js";
import { conversationSchema } from "./conversation.js";
import {
  currentModelSelectionSchema,
  modelProfileSchema,
  modelSelectionSchema,
} from "./model.js";
import {
  currentToolSelectionSchema,
  toolSchema,
  toolSelectionSchema,
} from "./tool.js";
import { currentWorkspaceSchema, workspaceSchema } from "./workspace.js";

export function createSuccessEnvelopeSchema<T extends z.ZodType>(data: T) {
  return z.object({ apiVersion: apiVersionSchema, data }).strict();
}

export const createWorkspaceRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    path: z.string().min(1),
  })
  .strict();

export const updateWorkspaceRequestSchema = createWorkspaceRequestSchema.partial();

export const setCurrentWorkspaceRequestSchema = z
  .object({ workspaceId: entityIdSchema })
  .strict();

export const createModelProfileRequestSchema = z
  .object({
    displayName: z.string().trim().min(1).max(100),
    baseUrl: z.url(),
    secretValue: z.string().min(1),
  })
  .strict();

export const updateModelProfileRequestSchema = createModelProfileRequestSchema
  .omit({ secretValue: true })
  .partial()
  .extend({ secretValue: z.string().min(1).optional() })
  .strict();

export const setCurrentModelSelectionRequestSchema = z
  .object({ selection: modelSelectionSchema.nullable() })
  .strict();

export const setCurrentToolSelectionRequestSchema = z
  .object({ selection: toolSelectionSchema })
  .strict();

export const createConversationRequestSchema = z
  .object({
    workspaceId: entityIdSchema,
    firstMessage: z.string().min(1),
    instructions: z.string().max(100_000).default(""),
  })
  .strict();

export const updateConversationRequestSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    instructions: z.string().max(100_000).optional(),
  })
  .strict();

export const workspaceResponseSchema = createSuccessEnvelopeSchema(workspaceSchema);
export const workspaceListResponseSchema = createSuccessEnvelopeSchema(
  z.array(workspaceSchema),
);
export const currentWorkspaceResponseSchema = createSuccessEnvelopeSchema(
  currentWorkspaceSchema.nullable(),
);
export const modelProfileResponseSchema = createSuccessEnvelopeSchema(
  modelProfileSchema,
);
export const conversationResponseSchema = createSuccessEnvelopeSchema(
  conversationSchema,
);

export const bootstrapResponseSchema = createSuccessEnvelopeSchema(
  z
    .object({
      workspaces: z.array(workspaceSchema),
      currentWorkspace: currentWorkspaceSchema.nullable(),
      modelProfiles: z.array(modelProfileSchema),
      currentModelSelection: currentModelSelectionSchema,
      tools: z.array(toolSchema),
      currentToolSelection: currentToolSelectionSchema,
    })
    .strict(),
);

export type CreateWorkspaceRequest = z.infer<
  typeof createWorkspaceRequestSchema
>;
export type UpdateWorkspaceRequest = z.infer<
  typeof updateWorkspaceRequestSchema
>;
export type CreateModelProfileRequest = z.infer<
  typeof createModelProfileRequestSchema
>;
export type CreateConversationRequest = z.infer<
  typeof createConversationRequestSchema
>;
export type BootstrapResponse = z.infer<typeof bootstrapResponseSchema>;
