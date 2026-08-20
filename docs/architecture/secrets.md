# SecretStore 架构

## 边界

模型 API Key 不进入数据库。`ModelProfile` 只保存 `source`、`reference` 和可展示的脱敏值；Harness Server 在实际调用模型前通过 `SecretStore` 解析真实值。

## 存储实现

- 单用户 V1 默认使用 `LocalJsonSecretStore`，把密钥写入 Harness Home 的 `config.json` 中的 `secrets` 对象。
- `config.json` 创建和重写时使用 `0600` 权限，但内容仍是明文，本机拥有文件读取权限的进程可以看到密钥。
- 环境变量存储继续作为可选方案。该方式只保存变量名，真实值由 Server 运行环境提供。
- `keychain` 来源仅为已有开发数据保留兼容读取，不再用于新建或更新 Profile。

## 生命周期

本地 JSON 存储支持写入、读取和删除。删除使用 `source=local` 的 Model Profile 时同步删除 `secrets` 中的对应字段。环境变量由 Harness Server 外部管理，因此 Server 只能读取，不能修改或删除。

## 日志安全

真实密钥不得进入错误 Envelope、结构化日志或数据库。`sanitizeForLogging()` 在记录外部错误前递归清理字符串、错误对象、数组和普通对象；`maskSecret()` 只生成 UI 可展示的末四位脱敏值。
