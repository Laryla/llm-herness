import { describe, expect, it } from "vitest";

import {
  apiVersionSchema,
  entityIdSchema,
  errorEnvelopeSchema,
  isoDateTimeSchema,
} from "../src/index.js";

describe("公共契约", () => {
  it("接受当前协议版本和合法公共字段", () => {
    expect(apiVersionSchema.parse("v1")).toBe("v1");
    expect(entityIdSchema.parse("turn_01JABCDEF0123456789")).toBeTruthy();
    expect(isoDateTimeSchema.parse("2026-08-19T12:00:00.000Z")).toBeTruthy();
  });

  it.each(["", "turn id", "a"])("拒绝非法实体 ID：%s", (value) => {
    expect(entityIdSchema.safeParse(value).success).toBe(false);
  });

  it("拒绝未知协议版本", () => {
    expect(apiVersionSchema.safeParse("v2").success).toBe(false);
  });

  it("错误 Envelope 可安全序列化且不接受任意字段", () => {
    const parsed = errorEnvelopeSchema.parse({
      apiVersion: "v1",
      error: {
        code: "workspace_unavailable",
        message: "工作空间当前不可用",
        retryable: false,
        details: { workspaceId: "workspace_01JABCDEF0123456789" },
      },
    });

    expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed);
    expect(
      errorEnvelopeSchema.safeParse({ ...parsed, secret: "should-not-pass" })
        .success,
    ).toBe(false);
  });
});
