# REST 管理资源，WebSocket 承载运行事件

Harness Server 使用 REST 管理 Model Profile、Model Catalog、对话历史和设置等资源；使用 WebSocket 承载 Turn 与 Step 状态、内容增量、Tool 调用与确认、Queued Message、Steering Message 和取消等双向实时事件。该拆分让普通资源保持清晰的请求响应语义，同时为 Web Client 和未来 Client 提供统一的持续运行通道；关键运行状态必须持久化，不能把 WebSocket 连接本身当作状态来源。
