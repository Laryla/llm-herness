# LLM Harness

LLM Harness 为多种客户端提供一致的大模型交互、能力调用和状态管理边界。

## Language

**Harness Server**:
统一承载模型访问、能力执行和共享状态的服务端；所有客户端通过它获得一致行为。
_Avoid_: Backend, API service, model proxy

**Harness Instance**:
由单个用户独占的一套 Harness Server 运行实例及其模型配置、对话和能力状态。第一阶段不在一个实例内划分多个用户或组织。
_Avoid_: Tenant, organization, shared account

**Local Harness**:
运行在用户设备上的 Harness Instance；模型密钥、对话与能力状态保留在本机，各 Client 通过本机接口访问。
_Avoid_: Cloud service, hosted account, local client

**Workspace**:
用户注册到 Harness Instance 的一个文件夹，也是文件类 Tool 的访问边界；Conversation 创建后归属于一个 Workspace。默认 Workspace 位于 `~/.llm/workspaces/default`。
_Avoid_: Harness Instance, repository, working directory

**Current Workspace**:
Harness Instance 当前选中的 Workspace，用于创建和浏览 Conversation；切换不会移动已有 Conversation 或复制 Workspace 文件。
_Avoid_: Current directory, default folder, Conversation workspace

**Client**:
通过 Harness Server 使用能力的交互入口，包括 Web Client、CLI Client，以及未来的浏览器插件等形态。
_Avoid_: Frontend, terminal user, end user

**Web Client**:
第一阶段提供的 React 客户端，与其他 Client 共享 Harness Server 中的状态和能力。
_Avoid_: Website, Web Server

**CLI Client**:
通过命令行使用 Harness Server 的客户端，与 Web Client 遵循相同的核心契约。
_Avoid_: Shell backend, local harness

## Model Access

**Model Profile**:
一套可被模型调用选择的 OpenAI 兼容连接配置，包含显示名称、服务地址、访问凭据和可选连接参数；它不设置默认模型。
_Avoid_: Provider, model, API config

**Model Selection**:
创建 Turn 时明确指定并在整个 Turn 内保持不变的 Model Profile 与模型名称；同一 Turn 的所有模型 Step 使用相同选择。
_Avoid_: Conversation model, default model, active provider

**Current Model Selection**:
Harness Instance 当前唯一选中的 Model Profile 与模型名称，由 Harness Server 持久化并在 Client 间共享；修改只影响之后创建的 Turn，不改变任何已有 Turn。
_Avoid_: Conversation default, per-message snapshot, runtime Step switch

**Model Catalog**:
某个 Model Profile 下可供选择的模型名称集合，由 OpenAI 兼容模型列表接口自动发现并允许用户手动补充；它不保证其中的模型一定可成功调用。
_Avoid_: Supported models, available models, model registry

**Model Adapter**:
把 Harness 的 Turn、消息与 Tool Binding 转换为上游模型协议的边界；第一阶段仅实现 OpenAI 兼容的 `/v1/chat/completions`。
_Avoid_: Model Profile, Responses API, provider SDK

## Capabilities

**Tool**:
由 Harness Server 注册和执行的原子能力，具有名称、用途描述和参数契约，可在对话中提供给模型调用。第一阶段的 Tool 使用 TypeScript 实现。
_Avoid_: Skill, plugin, workflow, function call

**Tool Policy**:
Tool 的执行确认规则，取值为自动执行或需要用户确认；未明确声明时必须要求确认。
_Avoid_: Plugin permission, user role, approval workflow

**Tool Binding**:
一次 Turn 可用的不可变 Tool 集合；Client 通过 Tool ID 选择，Harness Server 解析完整定义，并在该 Turn 的每次模型 Step 中携带对应 Schema。
_Avoid_: Global tools, conversation tools, client-provided schema

**Current Tool Selection**:
Harness Instance 当前唯一选中的 Tool ID 集合，由 Harness Server 持久化并在 Client 间共享；创建 Turn 时转换为该 Turn 的不可变 Tool Binding。
_Avoid_: Conversation tools, per-message tools, mutable Tool Binding

**Turn**:
从普通用户消息开始，到产生最终回复、失败或取消为止的一次连续执行过程；只属于一个 Conversation，可以包含多个 Step 和用户运行中追加的 Steering Message，创建后固定其模型与 Tool 快照。
_Avoid_: Request, WebSocket session, Run

**Step**:
Turn 中的一次原子执行，第一阶段包括模型调用和 Tool 执行；一个 Turn 可以包含多个模型 Step 与 Tool Step。
_Avoid_: Turn, message, HTTP request

**Iteration**:
Turn 中从一次模型 Step 开始、并包含该模型调用产生的全部 Tool Step 的循环单元；正式环境默认最多执行 50 个 Iteration，测试环境使用 8 个。
_Avoid_: Step, Turn, retry

**Trace**:
一个 Turn 持久化后的完整执行记录，展开后按顺序展示其中每个 Step 的状态、输入、输出、错误、耗时和用量；它属于 Conversation 历史的一部分。
_Avoid_: Application log, token stream, separate conversation

**Queued Message**:
活动 Turn 期间由用户提交、等待该 Turn 结束后创建新 Turn 的消息。
_Avoid_: Blocked request, Steering Message

**Steering Message**:
用户主动介入活动 Turn 的消息；它会停止当前模型 Step，并进入同一 Turn 的下一次模型 Step。
_Avoid_: Queued Message, new Turn, forced request

**Conversation**:
按时间顺序保存用户消息、模型消息与 Tool 交互的线性历史；第一阶段不包含消息分支。
_Avoid_: Turn, model context, thread branch

**Context Selection**:
某个模型 Step 从 Conversation 与当前 Turn 中选入模型请求的消息集合；超出限制的旧消息仍保存在 Conversation 中，只是不发送给模型。
_Avoid_: Conversation history, message deletion, automatic summary

**Conversation Instructions**:
Conversation 中可编辑的模型行为指令；每个 Turn 保存实际使用的指令快照，后续编辑不会改变历史 Turn。
_Avoid_: System message, default model, Skill
