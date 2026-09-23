import { useEffect, useMemo, useState } from "react";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePartPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from "@assistant-ui/react";
import { useAgUiRuntime } from "@assistant-ui/react-ag-ui";
import { HttpAgent } from "@ag-ui/client";

type AnyRecord = Record<string, any>;

function RuntimeProvider({ children }: { children: React.ReactNode }) {
  const agent = useMemo(() => new HttpAgent({ url: "/api/agent" }), []);
  const runtime = useAgUiRuntime({
    agent,
    showThinking: true,
    onError: (error: unknown) => console.error("AG-UI", error),
  });
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

function DataCard({ name, data }: { name: string; data: any }) {
  const titles: Record<string, string> = {
    jev_decision: "Jev · tool preflight",
    jev_state: "Jev · state estimate",
    whisper: "Whisper",
    intrusive_thought: "Intrusive thought",
    attention_shift: "Attention shift",
    unharnessed_state: "Runtime state",
    control_update: "Control update",
    control_error: "Control error",
    unharnessed_audit: "Harness event",
  };
  const compact = name === "unharnessed_state";
  return (
    <section className={`event-card event-${name} ${compact ? "event-compact" : ""}`}>
      <div className="event-title">{titles[name] ?? name}</div>
      {name === "jev_decision" ? <JevDecision data={data} /> :
       name === "whisper" ? <Whisper data={data} /> :
       name === "intrusive_thought" ? <Intrusive data={data} /> :
       name === "attention_shift" ? <Attention data={data} /> :
       compact ? <RuntimeStrip data={data} /> :
       <pre>{pretty(data)}</pre>}
    </section>
  );
}

function JevDecision({ data }: { data: AnyRecord }) {
  return (
    <div className="jev-grid">
      <span>tool</span><b>{String(data.tool ?? "—")}</b>
      <span>boringness</span><b>{num(data.boringness)}</b>
      <span>block probability</span><b>{num(data.blockProbability)}</b>
      <span>draw</span><b>{num(data.draw)}</b>
      <span>consecutive</span><b>{String(data.consecutiveBoringBlocks ?? 0)}</b>
      <span>result</span>
      <b className={data.blocked ? "bad" : data.forcedAllow ? "odd" : "good"}>
        {data.blocked ? "BLOCK" : data.forcedAllow ? "FORCED ALLOW" : "ALLOW"}
      </b>
    </div>
  );
}

function Whisper({ data }: { data: AnyRecord }) {
  return (
    <>
      <div className="chips">{(data.kinds ?? []).map((k: string) => <span key={k}>{k}</span>)}</div>
      <pre className="whisper-text">{String(data.content ?? "")}</pre>
    </>
  );
}

function Intrusive({ data }: { data: AnyRecord }) {
  return <div className="intrusive-text">{String(data.text ?? data.content ?? pretty(data))}</div>;
}

function Attention({ data }: { data: AnyRecord }) {
  const edge = data.edge ?? data;
  return <div className="attention-line"><b>{edge.from ?? "?"}</b><span>→</span><b>{edge.to ?? "?"}</b><small>{edge.mode}</small></div>;
}

function RuntimeStrip({ data }: { data: AnyRecord }) {
  const scores = data?.state?.scores ?? {};
  return (
    <div className="runtime-strip">
      <span>boredom <b>{num(scores.boredom)}</b></span>
      <span>curiosity <b>{num(scores.curiosity)}</b></span>
      <span>leave <b>{num(scores.urgeToLeave)}</b></span>
      <span>attention <b>{String(data?.state?.attention ?? "—")}</b></span>
    </div>
  );
}

function ToolCard({ part }: { part: any }) {
  return (
    <section className="tool-card">
      <div className="tool-title">
        <span>Tool</span>
        <b>{String(part.toolName ?? part.name ?? "tool")}</b>
        <small>{String(part.status?.type ?? part.status ?? "")}</small>
      </div>
      {part.args !== undefined && <details><summary>arguments</summary><pre>{pretty(part.args)}</pre></details>}
      {part.result !== undefined && <details open><summary>result</summary><pre>{pretty(part.result)}</pre></details>}
    </section>
  );
}

function MessageParts() {
  return (
    <MessagePrimitive.Parts>
      {({ part }: any) => {
        if (part.type === "text") return <div className="message-text"><MessagePartPrimitive.Text /></div>;
        if (part.type === "tool-call") return part.toolUI ?? <ToolCard part={part} />;
        if (part.type === "data") return <DataCard name={String(part.name ?? "data")} data={part.data} />;
        if (part.type === "reasoning") return <details className="reasoning"><summary>reasoning</summary><pre>{pretty(part.text ?? part)}</pre></details>;
        return null;
      }}
    </MessagePrimitive.Parts>
  );
}

function Conversation() {
  return (
    <ThreadPrimitive.Root className="thread-root">
      <ThreadPrimitive.Viewport className="thread-viewport">
        <div className="thread-intro">
          <span className="eyebrow">LIVE AGENT CONSOLE</span>
          <h1>Unharnessed</h1>
          <p>Piの会話・tool call・whisper・Jev判定を同じrunの時系列で表示します。</p>
        </div>
        <ThreadPrimitive.Messages>
          {({ message }: any) => (
            <MessagePrimitive.Root className={`message message-${message.role}`}>
              <div className="message-role">{message.role === "user" ? "You" : "Agent"}</div>
              <div className="message-body"><MessageParts /></div>
            </MessagePrimitive.Root>
          )}
        </ThreadPrimitive.Messages>
        <ThreadPrimitive.ViewportFooter className="composer-dock">
          <ComposerPrimitive.Root className="composer">
            <ComposerPrimitive.Input
              className="composer-input"
              placeholder="通常のプロンプトを入力…"
              rows={2}
              submitMode="enter"
            />
            <ComposerPrimitive.Send className="send-button">Send</ComposerPrimitive.Send>
          </ComposerPrimitive.Root>
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}

type ControlState = {
  desired?: { enabled: boolean; config: AnyRecord; revision: number; updatedAt: string };
  runtime?: AnyRecord;
  opik?: AnyRecord;
};

function ControlPanel() {
  const [state, setState] = useState<ControlState>({});
  const [error, setError] = useState("");

  const refresh = async () => {
    const response = await fetch("/api/state");
    if (!response.ok) throw new Error(await response.text());
    setState(await response.json());
  };

  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
    const stream = new EventSource("/api/live");
    stream.onmessage = (message) => {
      const payload = JSON.parse(message.data);
      if (payload.event?.type === "state") {
        setState((previous) => ({ ...previous, runtime: payload.event.data }));
      }
    };
    stream.onerror = () => setError("live state stream disconnected");
    return () => stream.close();
  }, []);

  const patch = async (body: AnyRecord) => {
    setError("");
    const response = await fetch("/api/control", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "control update failed");
    setState((previous) => ({ ...previous, desired: data }));
    await refresh();
  };

  const syncOpik = async (action: "push" | "pull") => {
    setError("");
    const response = await fetch(`/api/opik/${action}`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? `Opik ${action} failed`);
    await refresh();
  };

  const desired = state.desired;
  const config = desired?.config;
  const runtime = state.runtime;
  if (!desired || !config) return <aside className="control-panel"><p>Loading controls…</p></aside>;

  const setScalar = (key: string, value: any) => patch({ config: { [key]: value } }).catch((e) => setError(String(e)));
  const setSin = (key: string, value: number) => patch({ config: { sins: { [key]: value } } }).catch((e) => setError(String(e)));

  return (
    <aside className="control-panel">
      <header className="control-header">
        <div>
          <span className="eyebrow">CONTROL PLANE</span>
          <h2>Dynamics</h2>
        </div>
        <label className="switch-row">
          <span>{desired.enabled ? "on" : "off"}</span>
          <input type="checkbox" checked={desired.enabled} onChange={(e) => patch({ enabled: e.target.checked }).catch((x) => setError(String(x)))} />
        </label>
      </header>

      <div className="status-row">
        <span>rev {desired.revision}</span>
        <span className={state.opik?.enabled ? "good" : ""}>
          Opik {state.opik?.enabled ? state.opik?.controlVersion ?? "connected" : "off"}
        </span>
      </div>
      {state.opik?.enabled && (
        <div className="opik-actions">
          <span>{state.opik.controlPrompt}</span>
          <button onClick={() => syncOpik("pull").catch((e) => setError(String(e)))}>Pull</button>
          <button onClick={() => syncOpik("push").catch((e) => setError(String(e)))}>Push version</button>
        </div>
      )}
      {state.opik?.lastError && <div className="control-error">Opik: {state.opik.lastError}</div>}
      {error && <div className="control-error">{error}</div>}

      <ControlSection title="Emission">
        <Slider label="rate" value={config.rate} onChange={(v) => setScalar("rate", v)} />
        <Slider label="boredom boost" value={config.boredomBoost} onChange={(v) => setScalar("boredomBoost", v)} live={runtime?.state?.scores?.boredom} />
        <NumberControl label="cooldown" value={config.cooldown} min={0} max={100} onChange={(v) => setScalar("cooldown", v)} />
        <NumberControl label="max whispers" value={config.maxWhispers} min={0} max={100} onChange={(v) => setScalar("maxWhispers", v)} />
        <NumberControl label="max thoughts" value={config.maxThoughts} min={0} max={100} onChange={(v) => setScalar("maxThoughts", v)} />
      </ControlSection>

      <ControlSection title="Jev">
        <Toggle label="enabled" value={config.jev} onChange={(v) => setScalar("jev", v)} />
        <Toggle label="boring block" value={config.boringBlock} onChange={(v) => setScalar("boringBlock", v)} />
        <Slider label="block rate" value={config.boringBlockRate} onChange={(v) => setScalar("boringBlockRate", v)} />
        <NumberControl label="judge every" value={config.jevEvery} min={1} max={100} onChange={(v) => setScalar("jevEvery", v)} />
        <NumberControl label="force allow after" value={config.forceAllowAfter} min={0} max={100} onChange={(v) => setScalar("forceAllowAfter", v)} />
        <div className="live-note">consecutive blocks <b>{runtime?.consecutiveBoringBlocks ?? 0}</b></div>
      </ControlSection>

      <ControlSection title="Seven Sins">
        {Object.entries(config.sins).map(([key, value]) => (
          <Slider key={key} label={key} value={Number(value)} live={runtime?.state?.sins?.[key]} onChange={(v) => setSin(key, v)} />
        ))}
      </ControlSection>

      <ControlSection title="Thanatos / Fuck It">
        <Slider label="thanatos" value={config.thanatos} live={runtime?.state?.thanatos?.ending} onChange={(v) => setScalar("thanatos", v)} />
        <Toggle label="fuck it" value={config.fuckIt} onChange={(v) => setScalar("fuckIt", v)} />
      </ControlSection>

      <ControlSection title="Intrusive thought generator">
        <label className="field-label">model</label>
        <input className="text-field" value={config.thoughtModel} onChange={(e) => setState((s) => ({ ...s, desired: { ...s.desired!, config: { ...config, thoughtModel: e.target.value } } }))} onBlur={(e) => setScalar("thoughtModel", e.target.value)} />
        <label className="field-label">prompt</label>
        <textarea className="prompt-field" value={config.thoughtPrompt} onChange={(e) => setState((s) => ({ ...s, desired: { ...s.desired!, config: { ...config, thoughtPrompt: e.target.value } } }))} onBlur={(e) => setScalar("thoughtPrompt", e.target.value)} />
      </ControlSection>

      <ControlSection title="Runtime">
        <Meters runtime={runtime ?? {}} />
      </ControlSection>
    </aside>
  );
}

function Meters({ runtime }: { runtime: AnyRecord }) {
  const scores = runtime?.state?.scores ?? {};
  const names = ["boredom", "repetition", "surprise", "informationGain", "fixation", "curiosity", "urgeToLeave"];
  return (
    <div className="meters">
      {names.map((name) => (
        <div className="meter" key={name}>
          <span>{name}</span>
          <div><i style={{ width: `${Math.max(0, Math.min(1, Number(scores[name] ?? 0))) * 100}%` }} /></div>
          <b>{num(scores[name])}</b>
        </div>
      ))}
      <div className="live-note">attention <b>{String(runtime?.state?.attention ?? "—")}</b></div>
    </div>
  );
}

function ControlSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="control-section"><h3>{title}</h3>{children}</section>;
}

function Slider({ label, value, live, onChange }: { label: string; value: number; live?: number; onChange: (value: number) => void }) {
  const [local, setLocal] = useState(Number(value));
  useEffect(() => setLocal(Number(value)), [value]);
  return (
    <label className="slider-row">
      <span>{label}</span>
      <input type="range" min="0" max="1" step="0.01" value={local} onChange={(e) => setLocal(Number(e.target.value))} onPointerUp={() => onChange(local)} onKeyUp={() => onChange(local)} />
      <b>{local.toFixed(2)}</b>
      {live !== undefined && <em title="runtime">{num(live)}</em>}
    </label>
  );
}

function NumberControl({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="number-row">
      <span>{label}</span>
      <input type="number" value={value} min={min} max={max} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return <label className="toggle-row"><span>{label}</span><input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} /></label>;
}

function num(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : "—";
}

function pretty(value: unknown) {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

export function App() {
  return (
    <RuntimeProvider>
      <main className="app-shell">
        <Conversation />
        <ControlPanel />
      </main>
    </RuntimeProvider>
  );
}
