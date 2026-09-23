import { homedir } from "node:os";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createUnharnessedExtension, type UnharnessedRuntimeEvent } from "../../src/index.ts";
import type { ControlHub } from "./control.ts";
import type { OpikBridge } from "./opik.ts";

export type AgEvent = Record<string, unknown>;
export type EventSink = (event: AgEvent) => void;

const ROOT = resolve(import.meta.dirname, "../..");
const DEFAULT_AGENT_DIR = join(homedir(), ".pi", "agent");
const WORKSPACE_ROOT = resolve(process.env.UNHARNESSED_CONTROL_WORKSPACE ?? join(ROOT, ".local", "control-plane-workspaces"));
const SESSION_ROOT = resolve(process.env.UNHARNESSED_CONTROL_SESSIONS ?? join(ROOT, ".local", "control-plane-sessions"));
const AGENT_DIR = resolve(process.env.PI_CODING_AGENT_DIR ?? DEFAULT_AGENT_DIR);
const PROVIDER = process.env.UNHARNESSED_MAIN_PROVIDER ?? "opencodex";
const MODEL_ID = process.env.UNHARNESSED_MAIN_MODEL ?? "gpt-5.5";

function safeId(id: string) {
  const cleaned = id.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 96);
  return cleaned || randomUUID();
}

function toText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((v: any) => v?.text ?? v?.content ?? "").join("\n");
  if (value && typeof value === "object") {
    const content = (value as any).content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) return content.map((v: any) => v?.text ?? "").join("\n");
  }
  try { return JSON.stringify(value); } catch { return String(value ?? ""); }
}

export function lastUserText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "user") continue;
    const text = toText(message.content).trim();
    if (text) return text;
  }
  return "";
}

export class PiThreadManager {
  private runtime?: ModelRuntime;
  private threads = new Map<string, PiThread>();

  constructor(
    private readonly control: ControlHub,
    private readonly opik: OpikBridge,
    private readonly onLiveEvent: (threadId: string, event: unknown) => void,
  ) {}

  async status() {
    const runtime = await this.getRuntime().catch(() => undefined);
    return {
      provider: PROVIDER,
      model: MODEL_ID,
      agentDir: AGENT_DIR,
      workspaceRoot: WORKSPACE_ROOT,
      modelAvailable: Boolean(runtime?.getModel(PROVIDER, MODEL_ID)),
      threads: this.threads.size,
    };
  }

  async get(threadId: string) {
    const id = safeId(threadId);
    let thread = this.threads.get(id);
    if (!thread) {
      thread = await PiThread.create(id, await this.getRuntime(), this.control, this.opik, this.onLiveEvent);
      this.threads.set(id, thread);
    }
    return thread;
  }

  private async getRuntime() {
    if (!this.runtime) {
      this.runtime = await ModelRuntime.create({
        authPath: join(AGENT_DIR, "auth.json"),
        modelsPath: join(AGENT_DIR, "models.json"),
        modelsStorePath: join(AGENT_DIR, "models-store.json"),
      });
    }
    return this.runtime;
  }
}

class PiThread {
  private listeners = new Set<(event: UnharnessedRuntimeEvent) => void>();
  private busy = false;

  static async create(
    id: string,
    runtime: ModelRuntime,
    control: ControlHub,
    opik: OpikBridge,
    onLiveEvent: (threadId: string, event: unknown) => void,
  ) {
    const cwd = join(WORKSPACE_ROOT, id);
    const sessionDir = join(SESSION_ROOT, id);
    await mkdir(cwd, { recursive: true });
    await mkdir(sessionDir, { recursive: true });

    const model = runtime.getModel(PROVIDER, MODEL_ID);
    if (!model) throw new Error(`Model not configured: ${PROVIDER}/${MODEL_ID} in ${AGENT_DIR}`);

    let instance!: PiThread;
    const bridge = {
      getControl: () => control.extensionPatch(),
      subscribeControl: (handler: any) => control.subscribe(handler),
      emit: (event: UnharnessedRuntimeEvent) => {
        instance?.emitRuntime(event);
        onLiveEvent(id, event);
      },
    };

    const settings = SettingsManager.inMemory({
      compaction: { enabled: true },
      retry: { enabled: false },
      enableInstallTelemetry: false,
    });
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir: AGENT_DIR,
      settingsManager: settings,
      noExtensions: true,
      noSkills: true,
      noContextFiles: true,
      noThemes: true,
      noPromptTemplates: true,
      extensionFactories: [createUnharnessedExtension(bridge)],
    });
    await loader.reload();
    if (loader.getExtensions().errors.length) {
      throw new Error(`Extension load errors: ${JSON.stringify(loader.getExtensions().errors)}`);
    }

    const sessionManager = SessionManager.create(cwd, sessionDir);
    const { session } = await createAgentSession({
      cwd,
      agentDir: AGENT_DIR,
      modelRuntime: runtime,
      model,
      thinkingLevel: (process.env.UNHARNESSED_MAIN_THINKING as any) ?? "low",
      tools: ["read", "bash", "write", "edit", "attention_shift"],
      sessionManager,
      resourceLoader: loader,
      settingsManager: settings,
    });
    instance = new PiThread(id, cwd, session, control, opik);
    await session.bindExtensions({
      onError: (error) => {
        onLiveEvent(id, { type: "extension_error", error });
      },
    });
    return instance;
  }

  private constructor(
    readonly id: string,
    readonly cwd: string,
    readonly session: any,
    private readonly control: ControlHub,
    private readonly opik: OpikBridge,
  ) {}

  private emitRuntime(event: UnharnessedRuntimeEvent) {
    for (const listener of this.listeners) listener(event);
  }

  async run(prompt: string, runId: string, sink: EventSink, signal?: AbortSignal) {
    if (this.busy) throw new Error("This thread already has an active run");
    this.busy = true;
    const trace = this.opik.startRun({
      threadId: this.id,
      runId,
      prompt,
      control: this.control.snapshot(),
    });
    let assistantId = randomUUID();
    let messageOpen = false;
    let finalText = "";
    const toolMessageIds = new Map<string, string>();

    const send = (event: AgEvent) => {
      sink(event);
    };
    const ensureMessage = () => {
      if (messageOpen) return;
      messageOpen = true;
      send({ type: "TEXT_MESSAGE_START", messageId: assistantId, role: "assistant" });
    };
    const custom = (name: string, value: unknown) => {
      ensureMessage();
      send({ type: "CUSTOM", name, value });
      trace.event(name, value, name.startsWith("jev") ? "guardrail" : "general");
    };
    const closeMessage = () => {
      if (!messageOpen) return;
      send({ type: "TEXT_MESSAGE_END", messageId: assistantId });
      messageOpen = false;
    };

    const offRuntime = (event: UnharnessedRuntimeEvent) => {
      if (event.type === "state") {
        send({ type: "STATE_SNAPSHOT", snapshot: event.data });
        custom("unharnessed_state", event.data);
        return;
      }
      if (event.type === "whisper") {
        custom("whisper", event.data);
        return;
      }
      const kind = String((event.data as any).kind ?? "audit");
      if (kind === "tool_boredom") custom("jev_decision", event.data);
      else if (kind === "jev") custom("jev_state", event.data);
      else if (kind === "thought") custom("intrusive_thought", event.data);
      else if (kind === "attention") custom("attention_shift", event.data);
      else if (kind.startsWith("control_")) custom(kind, event.data);
      else custom("unharnessed_audit", event.data);
    };
    this.listeners.add(offRuntime);

    const unsubscribe = this.session.subscribe((event: any) => {
      if (event.type === "turn_start") {
        closeMessage();
        assistantId = randomUUID();
        messageOpen = false;
        return;
      }
      if (event.type === "message_update") {
        const delta = event.assistantMessageEvent;
        if (delta?.type === "text_delta") {
          ensureMessage();
          finalText += delta.delta;
          send({ type: "TEXT_MESSAGE_CONTENT", messageId: assistantId, delta: delta.delta });
        } else if (delta?.type === "thinking_start") {
          send({ type: "REASONING_START" });
          send({ type: "REASONING_MESSAGE_START", messageId: `reasoning-${assistantId}`, role: "assistant" });
        } else if (delta?.type === "thinking_delta") {
          send({ type: "REASONING_MESSAGE_CONTENT", messageId: `reasoning-${assistantId}`, delta: delta.delta });
        } else if (delta?.type === "thinking_end") {
          send({ type: "REASONING_MESSAGE_END", messageId: `reasoning-${assistantId}` });
          send({ type: "REASONING_END" });
        }
        return;
      }
      if (event.type === "tool_execution_start") {
        ensureMessage();
        const resultMessageId = randomUUID();
        toolMessageIds.set(event.toolCallId, resultMessageId);
        send({
          type: "TOOL_CALL_START",
          toolCallId: event.toolCallId,
          toolCallName: event.toolName,
          parentMessageId: assistantId,
        });
        send({ type: "TOOL_CALL_ARGS", toolCallId: event.toolCallId, delta: JSON.stringify(event.args ?? {}) });
        send({ type: "TOOL_CALL_END", toolCallId: event.toolCallId });
        trace.toolStart(event.toolCallId, event.toolName, event.args);
        return;
      }
      if (event.type === "tool_execution_end") {
        const content = toText(event.result);
        send({
          type: "TOOL_CALL_RESULT",
          messageId: toolMessageIds.get(event.toolCallId) ?? randomUUID(),
          toolCallId: event.toolCallId,
          content,
          role: "tool",
        });
        trace.toolEnd(event.toolCallId, event.result, Boolean(event.isError));
        return;
      }
      if (event.type === "turn_end") closeMessage();
    });

    let aborted = false;
    const abort = () => {
      aborted = true;
      void this.session.abort();
    };
    signal?.addEventListener("abort", abort, { once: true });

    try {
      send({ type: "STATE_SNAPSHOT", snapshot: this.control.snapshot() });
      await this.session.prompt(prompt);
      closeMessage();
      await trace.finish({ response: finalText, aborted });
      return { response: finalText, aborted };
    } catch (error) {
      closeMessage();
      await trace.finish(undefined, error);
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
      unsubscribe();
      this.listeners.delete(offRuntime);
      this.busy = false;
    }
  }

  async abort() {
    await this.session.abort();
  }

  dispose() {
    this.session.dispose();
  }
}
