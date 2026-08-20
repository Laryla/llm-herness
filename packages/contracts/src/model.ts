import { z } from "zod";

import {
  contractErrorSchema,
  entityIdSchema,
  isoDateTimeSchema,
} from "./common.js";

export const secretReferenceSchema = z
  .object({
    source: z.enum(["local", "keychain", "environment"]),
    reference: z.string().min(1),
    maskedValue: z.string().min(1),
  })
  .strict();

export const modelConnectionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("untested") }).strict(),
  z
    .object({
      status: z.literal("succeeded"),
      testedAt: isoDateTimeSchema,
      latencyMs: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      status: z.literal("failed"),
      testedAt: isoDateTimeSchema,
      error: contractErrorSchema,
    })
    .strict(),
]);

export const modelProfileSchema = z
  .object({
    id: entityIdSchema,
    displayName: z.string().trim().min(1).max(100),
    modelName: z.string().trim().min(1).max(200),
    baseUrl: z.url(),
    secret: secretReferenceSchema,
    connection: modelConnectionSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const modelSelectionSchema = z
  .object({
    profileId: entityIdSchema,
    modelName: z.string().trim().min(1).max(200),
  })
  .strict();

export const currentModelSelectionSchema = z
  .object({
    selection: modelSelectionSchema.nullable(),
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const modelParametersSchema = z
  .object({
    temperature: z.number().min(0).max(2).optional(),
    topP: z.number().min(0).max(1).optional(),
    maxTokens: z.number().int().positive().optional(),
    stop: z.array(z.string().min(1)).max(4).optional(),
  })
  .strict();

export type SecretReference = z.infer<typeof secretReferenceSchema>;
export type ModelConnection = z.infer<typeof modelConnectionSchema>;
export type ModelProfile = z.infer<typeof modelProfileSchema>;
export type ModelSelection = z.infer<typeof modelSelectionSchema>;
export type CurrentModelSelection = z.infer<
  typeof currentModelSelectionSchema
>;
export type ModelParameters = z.infer<typeof modelParametersSchema>;
