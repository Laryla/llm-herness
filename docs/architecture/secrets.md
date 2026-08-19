# SecretStore 架构

## 边界

模型 API Key 不进入数据库。`ModelProfile` 只保存 `source`、`reference` 和可展示的脱敏值；Harness Server 在实际调用模型前通过 `SecretStore` 解析真实值。

## 存储实现

- macOS 使用 Keychain，调用系统 `security` 命令；写入值通过标准输入传递，不进入进程参数。
- Linux 使用 Secret Service，调用 `secret-tool`，写入值同样通过标准输入传递。
- Windows 使用 Credential Manager，通过 PowerShell 调用原生 `CredWriteW`、`CredReadW`、`CredDeleteW` 与 `CredFree`；密钥通过标准输入传递。
- 系统密钥库不可用时回退到环境变量。环境变量存储只读，变量名就是密钥引用。

## 生命周期

系统密钥库实现支持写入、读取和删除。环境变量由 Harness Server 外部管理，因此 Server 只能读取，不能修改或删除。删除 Model Profile 时，只有 `source=keychain` 的引用需要同步删除。

## 日志安全

真实密钥不得进入错误 Envelope、结构化日志或数据库。`sanitizeForLogging()` 在记录外部错误前递归清理字符串、错误对象、数组和普通对象；`maskSecret()` 只生成 UI 可展示的末四位脱敏值。
