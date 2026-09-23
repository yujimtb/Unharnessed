import { Opik } from "opik";
import { parseConfig } from "../../src/dynamics.ts";
import type { DesiredControl } from "./control.ts";

type TraceLike = ReturnType<Opik["trace"]>;
type SpanLike = ReturnType<TraceLike["span"]>;

export class OpikBridge {
  readonly enabled: boolean;
  private client?: Opik;
  private readonly project = process.env.OPIK_PROJECT_NAME ?? "Unharnessed";
  private readonly controlPrompt = process.env.UNHARNESSED_OPIK_CONTROL_PROMPT ?? "unharnessed-control";
  private controlVersion?: string;
  private lastError?: string;

  constructor() {
    this.enabled = process.env.OPIK_ENABLED === "1" || Boolean(process.env.OPIK_URL_OVERRIDE || process.env.OPIK_API_KEY);
    if (this.enabled) {
      this.client = new Opik({ projectName: this.project });
    }
  }

  status() {
    return {
      enabled: this.enabled,
      project: this.project,
      endpoint: process.env.OPIK_URL_OVERRIDE ?? (this.enabled ? "SDK default" : null),
      controlPrompt: this.controlPrompt,
      controlVersion: this.controlVersion ?? null,
      lastError: this.lastError ?? null,
    };
  }

  async pullControl(fallback: DesiredControl): Promise<DesiredControl | null> {
    if (!this.client) return null;
    try {
      let prompt = await this.client.getPrompt({ name: this.controlPrompt, projectName: this.project });
      if (!prompt) {
        await this.pushControl(fallback, "Seed Unharnessed control plane");
        prompt = await this.client.getPrompt({ name: this.controlPrompt, projectName: this.project });
      }
      if (!prompt) return null;
      this.controlVersion = prompt.version;
      const metadata = (prompt.metadata as any)?.unharnessedControl ?? {};
      const config = parseConfig({ ...(metadata.config ?? fallback.config), thoughtPrompt: prompt.prompt });
      this.lastError = undefined;
      return {
        enabled: typeof metadata.enabled === "boolean" ? metadata.enabled : fallback.enabled,
        config,
        revision: Number.isSafeInteger(metadata.revision) ? Number(metadata.revision) : fallback.revision,
        updatedAt: typeof metadata.updatedAt === "string" ? metadata.updatedAt : fallback.updatedAt,
      };
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return null;
    }
  }

  async pushControl(control: DesiredControl, changeDescription = `Control revision ${control.revision}`) {
    if (!this.client) return null;
    try {
      const prompt = await this.client.createPrompt({
        name: this.controlPrompt,
        prompt: control.config.thoughtPrompt,
        projectName: this.project,
        description: "Versioned Unharnessed runtime configuration and intrusive-thought prompt",
        tags: ["unharnessed", "control-plane"],
        changeDescription,
        metadata: {
          unharnessedControl: {
            schema: 1,
            enabled: control.enabled,
            config: control.config,
            revision: control.revision,
            updatedAt: control.updatedAt,
          },
        } as any,
      });
      this.controlVersion = prompt.version;
      this.lastError = undefined;
      return { version: prompt.version ?? null };
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return null;
    }
  }

  startRun(args: { threadId: string; runId: string; prompt: string; control: DesiredControl }) {
    if (!this.client) return new NullRunTrace();
    const trace = this.client.trace({
      name: "unharnessed.run",
      input: { prompt: args.prompt },
      metadata: {
        threadId: args.threadId,
        runId: args.runId,
        controlRevision: args.control.revision,
        controlVersion: this.controlVersion,
        controlPrompt: this.controlPrompt,
        control: args.control,
      },
      tags: ["unharnessed", "control-plane"],
      threadId: args.threadId,
    } as any);
    return new RunTrace(trace, this.client);
  }
}

export class RunTrace {
  private tools = new Map<string, SpanLike>();
  constructor(private readonly trace: TraceLike, private readonly client: Opik) {}

  event(name: string, value: unknown, type: "general" | "guardrail" = "general") {
    const span = this.trace.span({ name, type, input: value as any } as any);
    span.end();
  }

  toolStart(id: string, name: string, input: unknown) {
    this.tools.get(id)?.end();
    this.tools.set(id, this.trace.span({ name: `tool.${name}`, type: "tool", input: input as any } as any));
  }

  toolEnd(id: string, result: unknown, isError: boolean) {
    const span = this.tools.get(id);
    if (!span) return;
    (span as any).update?.({ output: { result, isError } });
    span.end();
    this.tools.delete(id);
  }

  async finish(output: unknown, error?: unknown) {
    for (const span of this.tools.values()) span.end();
    this.tools.clear();
    (this.trace as any).update?.({ output: error ? { error: String(error) } : output });
    this.trace.end();
    await this.client.flush();
  }
}

class NullRunTrace {
  event(_name: string, _value: unknown, _type?: "general" | "guardrail") {}
  toolStart(_id: string, _name: string, _input: unknown) {}
  toolEnd(_id: string, _result: unknown, _isError: boolean) {}
  async finish(_output: unknown, _error?: unknown) {}
}
