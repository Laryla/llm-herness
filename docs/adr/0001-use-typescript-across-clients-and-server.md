# 客户端与服务端统一使用 TypeScript

LLM Harness 的 Web Client、CLI Client、未来浏览器插件和 Harness Server 统一使用 TypeScript，并共享 API 契约与领域类型。相比保留 Python/FastAPI 服务端，这一选择减少了跨语言契约漂移和多套工具实现的维护成本；如果未来必须使用 Python AI 生态，将通过独立 Python Tool Runner 扩展，而不改变核心服务的语言边界。
