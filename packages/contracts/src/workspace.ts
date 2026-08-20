import { z } from "zod";

import { entityIdSchema, isoDateTimeSchema } from "./common.js";

export const workspaceStatusSchema = z.enum(["available", "unavailable"]);

export const workspaceSchema = z
  .object({
    id: entityIdSchema,
    name: z.string().trim().min(1).max(100),
    path: z.string().min(1),
    status: workspaceStatusSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const currentWorkspaceSchema = z
  .object({
    workspaceId: entityIdSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export type WorkspaceStatus = z.infer<typeof workspaceStatusSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type CurrentWorkspace = z.infer<typeof currentWorkspaceSchema>;
