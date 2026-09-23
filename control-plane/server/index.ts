import "dotenv/config";
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { ControlHub } from "./control.ts";
import { OpikBridge } from "./opik.ts";
import { PiThreadManager, lastUserText, type AgEvent } from "./pi-thread.ts";

const PORT = Number(process.env.UNHARNESSED_CONTROL_PORT ?? 8787);
const HOST = process.env.UNHARNESSED_CONTROL_HOST ?? "127.0.0.1";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const control = new ControlHub();
await control.load();
const opik = new OpikBridge();
const remoteControl = await opik.pullControl(control.snapshot());
if (remoteControl) await control.hydrate(remoteControl);

const liveClients = new Set<express.Response>();
let latestRuntime: unknown = undefined;

function live(threadId: string, event: any) {
  if (event?.type === "state") latestRuntime = event.data;
  const payload = JSON.stringify({ threadId, event, at: new Date().toISOString() });
  for (const response of liveClients) response.write(`data: ${payload}\n\n`);
}

const threads = new PiThreadManager(control, opik, live);

function sse(response: express.Response, event: AgEvent) {
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

app.get("/api/health", async (_req, res) => {
  res.json({
    ok: true,
    pi: await threads.status(),
    opik: opik.status(),
    control: control.snapshot(),
  });
});

app.get("/api/config", (_req, res) => res.json(control.snapshot()));
app.get("/api/state", (_req, res) => res.json({ desired: control.snapshot(), runtime: latestRuntime, opik: opik.status() }));

app.patch("/api/control", async (req, res) => {
  try {
    const desired = await control.update(req.body ?? {});
    await opik.pushControl(desired);
    res.json(desired);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/opik/push", async (_req, res) => {
  const result = await opik.pushControl(control.snapshot(), "Manual control-plane push");
  res.json({ ok: Boolean(result) || !opik.status().enabled, result, opik: opik.status() });
});

app.post("/api/opik/pull", async (_req, res) => {
  const remote = await opik.pullControl(control.snapshot());
  if (remote) await control.hydrate(remote);
  res.json({ ok: Boolean(remote) || !opik.status().enabled, desired: control.snapshot(), opik: opik.status() });
});

app.get("/api/live", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  liveClients.add(res);
  res.write(`data: ${JSON.stringify({ threadId: null, event: { type: "snapshot", data: latestRuntime }, at: new Date().toISOString() })}\n\n`);
  const timer = setInterval(() => res.write(": heartbeat\n\n"), 15000);
  req.on("close", () => {
    clearInterval(timer);
    liveClients.delete(res);
  });
});

app.post("/api/agent", async (req, res) => {
  const input = req.body ?? {};
  const threadId = String(input.threadId ?? input.thread_id ?? randomUUID());
  const runId = String(input.runId ?? input.run_id ?? randomUUID());
  const prompt = lastUserText(Array.isArray(input.messages) ? input.messages : []);

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  sse(res, { type: "RUN_STARTED", threadId, runId, input });
  if (!prompt) {
    sse(res, { type: "RUN_ERROR", message: "No user prompt in AG-UI run input" });
    res.end();
    return;
  }

  const abortController = new AbortController();
  let completed = false;
  req.on("close", () => {
    if (!completed) abortController.abort();
  });

  try {
    const thread = await threads.get(threadId);
    const result = await thread.run(prompt, runId, (event) => sse(res, event), abortController.signal);
    completed = true;
    sse(res, { type: "RUN_FINISHED", threadId, runId });
  } catch (error) {
    completed = true;
    sse(res, {
      type: "RUN_ERROR",
      message: error instanceof Error ? error.message : String(error),
      code: "UNHARNESSED_RUN_ERROR",
    });
  } finally {
    res.end();
  }
});

app.post("/api/thread/:threadId/abort", async (req, res) => {
  try {
    const thread = await threads.get(req.params.threadId);
    await thread.abort();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Unharnessed control plane: http://${HOST}:${PORT}`);
  console.log(`AG-UI endpoint: http://${HOST}:${PORT}/api/agent`);
  console.log(`Opik: ${opik.status().enabled ? "enabled" : "disabled (set OPIK_URL_OVERRIDE or OPIK_ENABLED=1)"}`);
});
