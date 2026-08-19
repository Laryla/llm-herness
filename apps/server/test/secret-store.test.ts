import { describe, expect, it, vi } from "vitest";

import { sanitizeForLogging, maskSecret } from "../src/infrastructure/secrets/secret-redaction.js";
import {
  EnvironmentSecretStore,
  resolveSecret,
  selectSecretStore,
  SystemKeychainSecretStore,
  type CommandRunner,
  type SecretStore,
} from "../src/infrastructure/secrets/secret-store.js";

describe("SecretStore", () => {
  it("通过标准输入写入 macOS 密钥库，不把密钥放入进程参数", async () => {
    const secret = "sk-super-secret";
    const runner = vi.fn<CommandRunner>().mockResolvedValue({
      exitCode: 0,
      stdout: "",
    });
    const store = new SystemKeychainSecretStore("darwin", runner);

    await store.set("profile_test", secret);

    expect(runner).toHaveBeenCalledWith(
      "security",
      [
        "add-generic-password",
        "-a",
        "profile_test",
        "-s",
        "llm-harness",
        "-U",
        "-w",
      ],
      secret,
    );
    expect(runner.mock.calls[0]?.[1]).not.toContain(secret);
  });

  it("读取和删除系统密钥", async () => {
    const runner = vi
      .fn<CommandRunner>()
      .mockResolvedValueOnce({ exitCode: 0, stdout: "stored-secret\n" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "" });
    const store = new SystemKeychainSecretStore("darwin", runner);

    await expect(store.get("profile_test")).resolves.toBe("stored-secret");
    await expect(store.delete("profile_test")).resolves.toBeUndefined();
  });

  it("通过 Windows Credential Manager 保存多个独立引用", async () => {
    const secret = "windows-secret";
    const runner = vi
      .fn<CommandRunner>()
      .mockResolvedValueOnce({ exitCode: 0, stdout: "" })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: Buffer.from(secret, "utf8").toString("base64"),
      })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "" });
    const store = new SystemKeychainSecretStore("win32", runner);

    await store.set("profile_openai", secret);
    await expect(store.get("profile_openai")).resolves.toBe(secret);
    await store.delete("profile_openai");

    const setCall = runner.mock.calls[0];
    expect(setCall?.[0]).toBe("powershell.exe");
    expect(setCall?.[1]).toContain("set");
    expect(setCall?.[1]).toContain("llm-harness:profile_openai");
    expect(setCall?.[1]).not.toContain(secret);
    expect(setCall?.[2]).toBe(secret);
  });

  it("系统密钥库不可用时选择只读环境变量存储", async () => {
    const unavailableKeychain: SecretStore = {
      source: "keychain",
      isAvailable: () => Promise.resolve(false),
      get: () => Promise.resolve(null),
      set: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    };
    const environment = new EnvironmentSecretStore({
      LLM_HARNESS_MODEL_KEY: "env-secret",
    });

    const selected = await selectSecretStore(unavailableKeychain, environment);

    expect(selected.source).toBe("environment");
    await expect(selected.get("LLM_HARNESS_MODEL_KEY")).resolves.toBe("env-secret");
    await expect(selected.set("ignored", "value")).rejects.toMatchObject({
      code: "secret_store_read_only",
    });
  });

  it("按 SecretReference 来源解析密钥且缺失时返回结构化错误", async () => {
    const stores = {
      keychain: new EnvironmentSecretStore({}),
      environment: new EnvironmentSecretStore({ MODEL_KEY: "resolved" }),
    } as const;

    await expect(
      resolveSecret({ source: "environment", reference: "MODEL_KEY" }, stores),
    ).resolves.toBe("resolved");
    await expect(
      resolveSecret({ source: "keychain", reference: "missing" }, stores),
    ).rejects.toMatchObject({ code: "secret_not_found" });
  });
});

describe("密钥脱敏", () => {
  it("生成仅保留末四位的展示值", () => {
    expect(maskSecret("sk-1234567890")).toBe("••••••••7890");
    expect(maskSecret("1234")).toBe("••••");
  });

  it("递归清理日志对象、错误和循环引用中的密钥", () => {
    const secret = "sk-sensitive-value";
    const circular: Record<string, unknown> = {
      authorization: `Bearer ${secret}`,
      error: new Error(`请求 ${secret} 失败`),
    };
    circular.self = circular;

    const sanitized = sanitizeForLogging(circular, [secret]);
    const serialized = JSON.stringify(sanitized);

    expect(serialized).not.toContain(secret);
    expect(serialized).toContain("[REDACTED]");
    expect(serialized).toContain("[Circular]");
  });
});
