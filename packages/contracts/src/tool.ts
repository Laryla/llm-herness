import { z } from "zod";

import { entityIdSchema, isoDateTimeSchema } from "./common.js";

export const toolPolicySchema = z.enum([
  "automatic",
  "requires_confirmation",
]);

export const jsonSchemaSchema = z.record(z.string(), z.unknown());

export const toolSchema = z
  .object({
    id: entityIdSchema,
    modelName: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/),
    description: z.string().min(1).max(1_000),
    policy: toolPolicySchema,
    inputSchema: jsonSchemaSchema,
    outputSchema: jsonSchemaSchema,
  })
  .strict();

export const toolSelectionSchema = z
  .object({
    toolIds: z.array(entityIdSchema).max(100),
  })
  .strict()
  .refine(({ toolIds }) => new Set(toolIds).size === toolIds.length, {
    message: "toolIds 不允许重复",
    path: ["toolIds"],
  });

export const currentToolSelectionSchema = z
  .object({
    selection: toolSelectionSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const boundToolSchema = toolSchema
  .pick({
    id: true,
    modelName: true,
    description: true,
    policy: true,
    inputSchema: true,
    outputSchema: true,
  })
  .strict();

export const toolBindingSnapshotSchema = z
  .object({
    tools: z.array(boundToolSchema).max(100),
  })
  .strict()
  .refine(({ tools }) => new Set(tools.map(({ id }) => id)).size === tools.length, {
    message: "绑定的 Tool ID 不允许重复",
    path: ["tools"],
  })
  .refine(
    ({ tools }) =>
      new Set(tools.map(({ modelName }) => modelName)).size === tools.length,
    {
      message: "绑定的模型函数名不允许重复",
      path: ["tools"],
    },
  );

export type ToolPolicy = z.infer<typeof toolPolicySchema>;
export type Tool = z.infer<typeof toolSchema>;
export type ToolSelection = z.infer<typeof toolSelectionSchema>;
export type CurrentToolSelection = z.infer<typeof currentToolSelectionSchema>;
export type BoundTool = z.infer<typeof boundToolSchema>;
export type ToolBindingSnapshot = z.infer<typeof toolBindingSnapshotSchema>;
