# 统一支持 SQLite、MySQL 与 PostgreSQL

第一版将 SQLite、MySQL 和 PostgreSQL 作为正式支持的存储后端，并使用 Prisma 提供类型安全的数据访问和迁移能力；SQLite 是本地运行的默认选择。数据库类型在部署或首次初始化时选定，Harness Server 运行期间不支持切换，变更后必须重新初始化并重启。三种后端必须运行相同的契约测试并维护可验证的 Prisma Schema 与迁移；第一版不提供不同数据库之间的历史数据迁移。
