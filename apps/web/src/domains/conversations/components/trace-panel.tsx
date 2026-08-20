import type { Step, Trace } from "@llm-harness/contracts";
import { Braces, Cpu, Wrench, X } from "lucide-react";

const statusText: Record<Trace["turn"]["status"], string> = {
  awaiting_confirmation: "等待工具确认", cancelled: "已取消", completed: "已完成", failed: "失败", interrupted: "已中断", limit_reached: "达到循环上限", queued: "排队中", running: "运行中",
};

function stepName(step: Step) {
  return step.kind === "model" ? "模型调用" : step.kind === "tool" ? "工具调用" : "生成标题";
}

function formatJson(value: unknown) {
  try { return JSON.stringify(value, null, 2); } catch { return "无法序列化"; }
}

/** 右侧检查器只呈现 Server 持久化 Trace，不根据 UI 状态推测执行步骤。 */
export function TracePanel({ error, loading, onClose, trace }: { error: string | null; loading: boolean; onClose: () => void; trace: Trace | null }) {
  if (loading) return <aside className="trace trace-state"><span>正在读取 Trace…</span></aside>;
  if (error) return <aside className="trace trace-state error"><strong>Trace 加载失败</strong><span>{error}</span></aside>;
  if (!trace) return <aside className="trace trace-state"><span>选择一个 Turn 查看运行详情</span></aside>;
  const usage = trace.steps.reduce((sum, step) => sum + (step.usage?.totalTokens ?? 0), 0);
  return <aside className="trace"><header><div><strong>{statusText[trace.turn.status]}</strong><small>{trace.turn.id}</small></div><button aria-label="关闭运行详情" onClick={onClose}><X /></button></header><section className="summary"><b>● {statusText[trace.turn.status]}</b><small>{trace.iterations.length} Iterations</small><div><span><small>模型快照</small>{trace.turn.modelSelection.modelName}</span><span><small>绑定工具</small>{trace.turn.toolBinding.tools.length} 个</span><span><small>Tokens</small>{usage}</span></div></section><section className="turn-input"><small>用户输入</small><p>{trace.turn.userMessage}</p></section><section className="steps"><small>Step 轨迹</small>{trace.steps.map((step) => <div className={`trace-step ${step.status}`} key={step.id}><b>{step.kind === "tool" ? <Wrench /> : <Cpu />}</b><span><strong>Step {step.sequence} · {stepName(step)}</strong><i>{step.status}</i>{step.usage && <small>{step.usage.inputTokens} 输入 · {step.usage.outputTokens} 输出 tokens</small>}<details><summary><Braces />输入 / 输出</summary><pre>{formatJson({ input: step.input, output: step.output, error: step.error })}</pre></details></span></div>)}</section></aside>;
}
