# 数据库与 Harness Home

## Harness Home

默认目录为 `~/.llm`：

```text
~/.llm/
├── config.json
├── data/
│   └── harness.db
├── logs/
└── workspaces/
    └── default/
```

Server 启动时幂等创建这些目录。`config.json` 只保存非敏感设置，不保存数据库连接串或模型 API Key，文件权限为当前用户读写。

## Provider 选择

支持以下部署期 Provider：

- `sqlite`：本地默认值，数据库文件为 `HARNESS_HOME/data/harness.db`；
- `mysql`：需要显式提供 `DATABASE_URL`；
- `postgresql`：需要显式提供 `DATABASE_URL`。

Provider 写入 Harness Home 后不能在运行期间切换。要换 Provider，必须使用新的 Harness Home 或未来提供的数据迁移流程；V1 不迁移历史数据。

## Prisma Schema 与迁移

领域模型的单一来源是：

```text
apps/server/prisma/schema.template.prisma
```

`yarn workspace @llm-harness/server db:generate` 会从模板生成三份 Provider Schema 和三套 Prisma Client。MySQL 的长文本字段在生成时增加 `@db.LongText`，其余模型保持一致。

每个 Provider 有独立迁移目录：

```text
apps/server/prisma/{sqlite,mysql,postgresql}/migrations/
```

`yarn dev` 和 `yarn start` 会先执行当前 Provider 的 `prisma migrate deploy`。也可以手动执行：

```bash
yarn workspace @llm-harness/server db:migrate
```

## 数据库测试

SQLite 契约测试包含在普通 `yarn test` 中。MySQL 与 PostgreSQL 使用临时 Docker 容器执行相同的连接、CRUD、排序和事务回滚契约：

```bash
yarn test:integration
```

测试结束后自动删除容器和测试卷。

## 密钥规则

`ModelProfile` 只保存：

- Secret 来源；
- Secret 引用；
- 脱敏展示值。

三种数据库均不得建立明文 `apiKey` 字段。真实密钥由后续 `SecretStore` 模块管理。
