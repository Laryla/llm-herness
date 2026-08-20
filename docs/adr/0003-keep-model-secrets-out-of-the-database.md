# 模型密钥不写入数据库

Model Profile 在数据库中只保存密钥引用和可安全展示的脱敏信息。单用户 V1 为降低跨平台复杂度，真实 API Key 默认明文存放在 Harness Home 的 `config.json`，并由 Harness Server 通过 `LocalJsonSecretStore` 读取；也可以使用环境变量引用。SQLite、MySQL 和 PostgreSQL 均不保存模型密钥。

该选择接受本机文件可读进程能够获取密钥的风险。`config.json` 使用 `0600` 权限，接口响应和日志仍不得返回明文。
