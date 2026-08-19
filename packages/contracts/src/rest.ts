import { z } from "zod";

import { apiVersionSchema, entityIdSchema } from "./common.js";
import { conversationSchema, turnSchema } from "./conversation.js";
import { messageSchema, traceSchema } from "./message.js";
import {
  currentModelSelectionSchema,
  modelCatalogSchema,
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

const modelProfileMutationSchema = z
  .object({
    displayName: z.string().trim().min(1).max(100),
    baseUrl: z.url(),
    secretValue: z.string().min(1).optional(),
    secretEnvironmentVariable: z
      .string()
      .regex(/^[A-Z_][A-Z0-9_]{0,127}$/)
      .optional(),
  })
  .strict()
  .refine(
    ({ secretValue, secretEnvironmentVariable }) =>
      (secretValue === undefined) !== (secretEnvironmentVariable === undefined),
    { message: "必须且只能提供一种密钥来源" },
  );

export const createModelProfileRequestSchema = modelProfileMutationSchema;

export const updateModelProfileRequestSchema = z
  .object({
    displayName: z.string().trim().min(1).max(100).optional(),
    baseUrl: z.url().optional(),
    secretValue: z.string().min(1).optional(),
    secretEnvironmentVariable: z
      .string()
      .regex(/^[A-Z_][A-Z0-9_]{0,127}$/)
      .optional(),
  })
  .strict()
  .refine(
    ({ secretValue, secretEnvironmentVariable }) =>
      secretValue === undefined || secretEnvironmentVariable === undefined,
    { message: "不能同时提供两种密钥来源" },
  );

export const createManualModelRequestSchema = z
  .object({ modelName: z.string().trim().min(1).max(200) })
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
export const modelProfileListResponseSchema = createSuccessEnvelopeSchema(
  z.array(modelProfileSchema),
);
export const modelCatalogResponseSchema = createSuccessEnvelopeSchema(
  modelCatalogSchema,
);
export const currentModelSelectionResponseSchema = createSuccessEnvelopeSchema(
  currentModelSelectionSchema,
);
export const conversationResponseSchema = createSuccessEnvelopeSchema(
  conversationSchema,
);
export const conversationListResponseSchema = createSuccessEnvelopeSchema(
  z.array(conversationSchema),
);
export const messageListResponseSchema = createSuccessEnvelopeSchema(
  z.array(messageSchema),
);
export const turnListResponseSchema = createSuccessEnvelopeSchema(
  z.array(turnSchema),
);
export const traceResponseSchema = createSuccessEnvelopeSchema(traceSchema);

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
export type UpdateModelProfileRequest = z.infer<
  typeof updateModelProfileRequestSchema
>;
export type CreateManualModelRequest = z.infer<
  typeof createManualModelRequestSchema
>;
export type CreateConversationRequest = z.infer<
  typeof createConversationRequestSchema
>;
export type UpdateConversationRequest = z.infer<
  typeof updateConversationRequestSchema
>;
export type BootstrapResponse = z.infer<typeof bootstrapResponseSchema>;
