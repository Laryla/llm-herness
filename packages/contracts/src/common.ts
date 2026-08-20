import { z } from "zod";

export const API_VERSION = "v1" as const;

export const apiVersionSchema = z.literal(API_VERSION);

export const entityIdSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[a-z][a-z0-9]*(?:_[A-Za-z0-9]+)+$/);

export const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const errorDetailSchema = z.record(z.string(), z.unknown());

export const contractErrorSchema = z
  .object({
    code: z.string().min(1).max(100),
    message: z.string().min(1),
    retryable: z.boolean(),
    details: errorDetailSchema.optional(),
  })
  .strict();

export const errorEnvelopeSchema = z
  .object({
    apiVersion: apiVersionSchema,
    error: contractErrorSchema,
  })
  .strict();

export type ApiVersion = z.infer<typeof apiVersionSchema>;
export type EntityId = z.infer<typeof entityIdSchema>;
export type ContractError = z.infer<typeof contractErrorSchema>;
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
