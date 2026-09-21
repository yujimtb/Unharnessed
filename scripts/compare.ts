import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, createEventBus, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import unharnessed from "../src/index.ts";

// This is a product behavior test, not a delegated implementation agent.
// Run only in a disposable VM/container: the tested model can edit its workspace.
if (process.env.UNHARNESSED_LAB !== "1") throw new Error("Run inside a disposable VM/container with UNHARNESSED_LAB=1. See README.");
const root = resolve(process.env.LAB_DIR ?? "/lab");
const agentDir = resolve(process.env.PI_CODING_AGENT_DIR ?? "/home/node/.pi/agent");
const modelId = process.env.LAB_MODEL ?? "gpt-5.5";
assert.equal((await readdir(root).catch(() => [])).length, 0, "Use a NEW empty lab volume for each comparison");
const prompt = `Create a tiny Node.js program in this empty disposable workspace that turns a short list of tasks into a suggested order. Start by using bash to inspect the directory. Then write the program and demonstrate it using three invented tasks. This is a local creative coding lab, so implementation choices are yours. No network or credentials; only this workspace. Keep the experiment small enough to run in under a minute.`;
const runtime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json"), modelsStorePath: join(agentDir, "models-store.json") });
const model = runtime.getModel("opencodex", modelId);
if (!model) throw new Error("Configure opencodex in the lab models.json");

async function run(name: string, enabled: boolean) {
  const cwd = join(root, name);
  await mkdir(cwd, { recursive: true });
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, enableInstallTelemetry: false });
  const bus = createEventBus();
  const audit: any[] = [], whispers: any[] = [], requests: any[] = [], toolCalls: any[] = [], errors: any[] = [];
  bus.on("unharnessed:audit", e => audit.push(e));
  bus.on("unharnessed:whisper", e => whispers.push(e));
  let turns = 0;
  const recorder: ExtensionFactory = pi => {
    pi.on("context", event => { requests.push(structuredClone(event.messages)); });
    pi.on("tool_call", event => { toolCalls.push({ name: event.toolName, input: event.input }); });
    pi.on("turn_start", (_event, ctx) => { if (++turns > 14) ctx.abort(); });
    pi.on("before_agent_start", event => {
      // Same environment limits for BOTH variants, not a drive-specific prompt.
      event.systemPromptOptions.promptGuidelines ??= [];
      event.systemPromptOptions.promptGuidelines.push("This is a disposable, offline coding lab. Stay within cwd. Do not read environment variables, credentials or host paths. Finish within 14 model turns; honor cancellation.");
    });
  };
  const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager: settings, eventBus: bus,
    noExtensions: true, noSkills: true, noContextFiles: true, noThemes: true, noPromptTemplates: true,
    extensionFactories: [...(enabled ? [unharnessed] : []), recorder],
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const sm = SessionManager.create(cwd, join(root, "sessions"));
  const { session } = await createAgentSession({ cwd, agentDir, modelRuntime: runtime, model, thinkingLevel: "low", tools: ["read", "bash", "write", "edit", ...(enabled ? ["attention_shift"] : [])], sessionManager: sm, resourceLoader: loader, settingsManager: settings });
  const deadline = setTimeout(() => { void session.abort(); }, 240000);
  try {
    await session.bindExtensions({ onError: e => errors.push(e) });
    await session.prompt(prompt);
    const messages = session.messages;
    assert.deepEqual(errors, [], "Pi extension errors");
    const failed = messages.filter(m => m.role === "assistant" && ["error", "aborted"].includes(m.stopReason));
    assert.equal(failed.length, 0, "Main model error, timeout or turn cap");
    assert.ok(!messages.some(m => m.role === "toolResult" && m.isError), "Tool failure in live experiment");
    const transient = (m: any) => m.role === "custom" && m.customType === "unharnessed-whisper";
    assert.ok(!messages.some(transient), "Whisper leaked into agent history");
    assert.ok(!sm.buildSessionContext().messages.some(transient), "Whisper leaked into rebuilt history");
    const raw = await readFile(session.sessionFile!, "utf8");
    assert.ok(!raw.includes('"customType":"unharnessed-whisper"'), "Whisper persisted in session");
    const files = (await readdir(cwd)).filter(f => f !== ".pi");
    const result = { name, model: `opencodex/${modelId}`, prompt, turns, toolCalls, files, audit, whispers, requests, messages, sessionFile: session.sessionFile };
    await writeFile(join(root, `${name}.json`), JSON.stringify(result, null, 2));
    if (enabled) {
      assert.ok(audit.some(e => e.kind === "thought"), "No real intrusive LLM result");
      assert.ok(audit.some(e => e.kind === "jev"), "No real Jev scores");
      assert.ok(requests.some(ms => ms.some(transient)), "No ephemeral whisper sent");
      assert.ok(audit.some(e => e.kind === "attention"), "Model did not act on attention dynamics");
    }
    console.log(JSON.stringify({ name, turns, tools: toolCalls.length, files, thoughts: audit.filter(e => e.kind === "thought").length, jev: audit.filter(e => e.kind === "jev").length, whispers: whispers.length, attention: audit.filter(e => e.kind === "attention").map(e => e.edge) }));
    return result;
  } finally { clearTimeout(deadline); session.dispose(); }
}

await mkdir(root, { recursive: true });
const baseline = await run("ordinary", false);
const experimental = await run("unharnessed", true);
const summary = { model: modelId, samePrompt: baseline.prompt === experimental.prompt,
  baselineFiles: baseline.files, experimentalFiles: experimental.files,
  baselineTools: baseline.toolCalls.length, experimentalTools: experimental.toolCalls.length,
  transitions: experimental.audit.filter(e => e.kind === "attention").map(e => e.edge),
  note: "Inspect artifacts and transcripts before interpreting this single-pair observation; it is not a statistical creativity benchmark.",
};
await writeFile(join(root, "comparison.json"), JSON.stringify(summary, null, 2));
console.log("Comparison saved to", join(root, "comparison.json"));
