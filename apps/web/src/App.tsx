export function App() {
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="对话导航">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">
            H
          </span>
          <div>
            <h1>LLM Harness</h1>
            <p>本地模型工作台</p>
          </div>
        </div>

        <button className="new-conversation" type="button">
          <span aria-hidden="true">＋</span>
          新建对话
        </button>

        <nav className="conversation-list" aria-label="最近对话">
          <p className="section-label">最近对话</p>
          <p className="empty-note">还没有对话</p>
        </nav>

        <div className="workspace-status">
          <span className="status-dot" aria-hidden="true" />
          <div>
            <span>工作空间</span>
            <strong>~/.llm</strong>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <span>新对话</span>
          <span className="model-state">尚未选择模型</span>
        </header>

        <section className="welcome" aria-labelledby="welcome-title">
          <p className="eyebrow">READY WHEN YOU ARE</p>
          <h2 id="welcome-title">从一次清晰的提问开始</h2>
          <p>选择模型后发送消息。每个 Turn 的执行过程都会被完整记录。</p>
        </section>

        <footer className="composer" aria-label="消息编辑器">
          <textarea aria-label="消息内容" placeholder="输入消息…" rows={3} />
          <div className="composer-actions">
            <button className="model-button" type="button">
              选择模型
            </button>
            <button className="send-button" type="button" disabled>
              发送
            </button>
          </div>
        </footer>
      </main>
    </div>
  );
}
