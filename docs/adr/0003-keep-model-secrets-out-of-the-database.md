# 模型密钥不写入数据库

Model Profile 在数据库中只保存密钥引用和可安全展示的脱敏信息，真实 API Key 默认存放在操作系统密钥库，并由 Harness Server 通过统一 SecretStore 读取。无法使用系统密钥库的服务部署可以通过环境变量注入密钥；SQLite、MySQL 和 PostgreSQL 均不得保存明文模型密钥。
