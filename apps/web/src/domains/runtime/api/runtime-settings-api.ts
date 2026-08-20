import {
  currentToolSelectionSchema,
  type CurrentToolSelection,
} from "@llm-harness/contracts";

import { requestApi } from "../../../shared/api/client.js";

/** 每次创建 Turn 前读取工具选择，保证发送的是明确快照而不是前端猜测的默认值。 */
export function getCurrentToolSelection(): Promise<CurrentToolSelection> {
  return requestApi("/api/v1/current-tool-selection", currentToolSelectionSchema);
}
