/** 供应商无关的函数工具描述。V1 使用 JSON Schema 描述输入。 */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}
