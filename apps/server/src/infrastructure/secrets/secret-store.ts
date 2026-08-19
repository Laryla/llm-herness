import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import type { SecretReference } from "@llm-harness/contracts";

const DEFAULT_SERVICE = "llm-harness";
const WINDOWS_CREDENTIAL_SCRIPT = fileURLToPath(
  new URL("../../../scripts/windows-credential.ps1", import.meta.url),
);

export class SecretStoreError extends Error {
  constructor(
    readonly code:
      | "secret_not_found"
      | "secret_store_unavailable"
      | "secret_store_read_only"
      | "secret_store_operation_failed",
    message: string,
  ) {
    super(message);
  }
}

export interface SecretStore {
  readonly source: SecretReference["source"];
  isAvailable(): Promise<boolean>;
  get(reference: string): Promise<string | null>;
  set(reference: string, value: string): Promise<void>;
  delete(reference: string): Promise<void>;
}

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
}

export type CommandRunner = (
  command: string,
  args: readonly string[],
  input?: string,
) => Promise<CommandResult>;

export const runSecretCommand: CommandRunner = (command, args, input) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.once("error", reject);
    child.once("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stdout });
    });
    child.stdin.end(input);
  });

function validateReference(reference: string): void {
  if (reference.length === 0 || reference.length > 200) {
    throw new SecretStoreError(
      "secret_store_operation_failed",
      "密钥引用长度必须在 1–200 个字符之间",
    );
  }
}

export class SystemKeychainSecretStore implements SecretStore {
  readonly source = "keychain" as const;

  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly runCommand: CommandRunner = runSecretCommand,
    private readonly service = DEFAULT_SERVICE,
  ) {}

  async isAvailable(): Promise<boolean> {
    try {
      // macOS：检查系统“钥匙串”命令是否可正常执行。
      if (this.platform === "darwin") {
        const result = await this.runCommand("security", ["default-keychain"]);
        return result.exitCode === 0;
      }
      // Linux：检查用于访问 Secret Service 的 secret-tool 是否可用。
      if (this.platform === "linux") {
        const result = await this.runCommand("secret-tool", ["--help"]);
        return result.exitCode === 0;
      }
      // Windows：通过 PowerShell 脚本探测凭据管理器是否可用。
      if (this.platform === "win32") {
        const result = await this.runCommand("powershell.exe", [
          "-NoProfile", // 不加载用户的 PowerShell 配置。
          "-NonInteractive", // 禁止交互式输入。
          "-ExecutionPolicy",
          "Bypass", // 仅本次执行绕过脚本执行策略。
          "-File",
          WINDOWS_CREDENTIAL_SCRIPT, // Windows 凭据管理脚本。
          "probe", // 执行可用性探测操作。
          this.windowsTarget("probe"), // 生成用于探测的临时凭据目标名称。
        ]);
        return result.exitCode === 0;
      }
      // 其他操作系统暂不支持系统密钥库。
      return false;
    } catch {
      return false;
    }
  }

  async get(reference: string): Promise<string | null> {
    validateReference(reference);
    const result = await this.execute(
      this.platform === "darwin"
        ? ["security", ["find-generic-password", "-a", reference, "-s", this.service, "-w"]]
        : this.platform === "win32"
          ? this.windowsCommand("get", reference)
          : ["secret-tool", ["lookup", "service", this.service, "reference", reference]],
    );
    if (result.exitCode !== 0) {
      return null;
    }
    const output = result.stdout.replace(/\r?\n$/, "");
    return this.platform === "win32"
      ? Buffer.from(output, "base64").toString("utf8")
      : output;
  }

  async set(reference: string, value: string): Promise<void> {
    validateReference(reference);
    if (value.length === 0) {
      throw new SecretStoreError(
        "secret_store_operation_failed",
        "密钥值不能为空",
      );
    }
    const result = await this.execute(
      this.platform === "darwin"
        ? [
            "security",
            [
              "add-generic-password",
              "-a",
              reference,
              "-s",
              this.service,
              "-U",
              "-w",
            ],
          ]
        : this.platform === "win32"
          ? this.windowsCommand("set", reference)
          : [
            "secret-tool",
            [
              "store",
              "--label",
              `LLM Harness: ${reference}`,
              "service",
              this.service,
              "reference",
              reference,
            ],
            ],
      value,
    );
    if (result.exitCode !== 0) {
      throw new SecretStoreError(
        "secret_store_operation_failed",
        "写入操作系统密钥库失败",
      );
    }
  }

  async delete(reference: string): Promise<void> {
    validateReference(reference);
    const result = await this.execute(
      this.platform === "darwin"
        ? ["security", ["delete-generic-password", "-a", reference, "-s", this.service]]
        : this.platform === "win32"
          ? this.windowsCommand("delete", reference)
          : ["secret-tool", ["clear", "service", this.service, "reference", reference]],
    );
    if (result.exitCode !== 0 && !(this.platform === "darwin" && result.exitCode === 44)) {
      throw new SecretStoreError(
        "secret_store_operation_failed",
        "从操作系统密钥库删除密钥失败",
      );
    }
  }

  private async execute(
    command: readonly [string, readonly string[]],
    input?: string,
  ): Promise<CommandResult> {
    if (
      this.platform !== "darwin" &&
      this.platform !== "linux" &&
      this.platform !== "win32"
    ) {
      throw new SecretStoreError(
        "secret_store_unavailable",
        `当前平台不支持系统密钥库：${this.platform}`,
      );
    }
    try {
      return await this.runCommand(command[0], command[1], input);
    } catch {
      throw new SecretStoreError(
        "secret_store_unavailable",
        "操作系统密钥库不可用",
      );
    }
  }

  private windowsTarget(reference: string): string {
    return `${this.service}:${reference}`;
  }

  private windowsCommand(
    operation: "get" | "set" | "delete",
    reference: string,
  ): readonly [string, readonly string[]] {
    return [
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        WINDOWS_CREDENTIAL_SCRIPT,
        operation,
        this.windowsTarget(reference),
      ],
    ];
  }
}

export class EnvironmentSecretStore implements SecretStore {
  readonly source = "environment" as const;

  constructor(
    private readonly environment: Record<string, string | undefined> = process.env,
  ) {}

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }

  get(reference: string): Promise<string | null> {
    validateReference(reference);
    return Promise.resolve(this.environment[reference] ?? null);
  }

  set(): Promise<void> {
    return Promise.reject(
      new SecretStoreError(
        "secret_store_read_only",
        "环境变量密钥存储只读，请在启动 Harness Server 前设置变量",
      ),
    );
  }

  delete(): Promise<void> {
    return Promise.reject(
      new SecretStoreError(
        "secret_store_read_only",
        "环境变量密钥存储只读，请从运行环境中删除变量",
      ),
    );
  }
}

export async function selectSecretStore(
  keychain: SecretStore = new SystemKeychainSecretStore(),
  environment: SecretStore = new EnvironmentSecretStore(),
): Promise<SecretStore> {
  return (await keychain.isAvailable()) ? keychain : environment;
}

export async function resolveSecret(
  reference: Pick<SecretReference, "source" | "reference">,
  stores: Readonly<Record<SecretReference["source"], SecretStore>>,
): Promise<string> {
  const value = await stores[reference.source].get(reference.reference);
  if (value === null) {
    throw new SecretStoreError("secret_not_found", "找不到模型密钥");
  }
  return value;
}
