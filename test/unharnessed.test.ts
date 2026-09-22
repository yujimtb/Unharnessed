import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DEFAULTS, HESITATION, evolve, freshState, observe, parseConfig, probability, restoreState, shift } from "../src/dynamics.ts";
import { judge, judgeToolBoredom, parseScores, toolCallTelemetry } from "../src/jev.ts";
import unharnessed, { THOUGHT_PROMPT } from "../src/index.ts";

function reply(text = "Make a compiler whose syntax is a tide table."): AssistantMessage {
  return { role: "assistant", content: [{ type: "text", text }], api: "openai-completions", provider: "opencodex", model: "gpt-5.5", stopReason: "stop", timestamp: Date.now(), usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}
function fixture(overrides = {}) {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const tools = new Map<string, any>();
  const entries: any[] = [];
  const audits: any[] = [];
  const requests: any[] = [];
  const notices: string[] = [];
  const sentMessages: any[] = [];
  const config = parseConfig({ rate: 1, cooldown: 0, jev: false, ...overrides });
  entries.push({ type: "custom", customType: "unharnessed-state", data: { config, state: freshState(config), enabled: true } });
  const pi = {
    on: (name: string, handler: Function) => handlers.set(name, handler),
    registerFlag() {}, getFlag() { return false; },
    registerCommand: (name: string, command: any) => commands.set(name, command),
    registerTool: (tool: any) => tools.set(tool.name, tool),
    appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }),
    sendMessage: (message: any, options: any) => {
      const persisted = { role: "custom", ...message, timestamp: Date.now() };
      sentMessages.push({ message: persisted, options });
      entries.push({ type: "message", message: persisted });
    },
    events: { emit: (name: string, value: unknown) => audits.push({ name, value }) },
  };
  const ctx = {
    hasUI: true,
    isIdle: () => true, abort() {},
    signal: undefined as AbortSignal | undefined,
    ui: { notify: (text: string) => notices.push(text), setStatus() {} },
    sessionManager: { getBranch: () => entries, getSessionFile: () => undefined },
    modelRegistry: {
      find: () => ({ id: "gpt-5.5", provider: "opencodex" }),
      streamSimple: (_model: unknown, context: unknown, options: unknown) => {
        requests.push({ context, options }); return { result: async () => reply() };
      },
    },
  };
  unharnessed(pi as unknown as ExtensionAPI);
  const emit = (name: string, data = {}) => handlers.get(name)!(name === "before_agent_start" ? { systemPromptOptions: {}, ...data } : data, ctx);
  const command = (args: string) => commands.get("unharnessed").handler(args, ctx);
  return { emit, command, tools, ctx, entries, requests, audits, notices, sentMessages };
}

test("configuration validation, repeated observations, state dynamics and bounded attention", () => {
  for (const bad of [null, [], { rate: -1 }, { rate: NaN }, { cooldown: 1.5 }, { maxWhispers: Infinity }, { enabled: "yes" }, { boringBlock: "yes" }, { boringBlockRate: 2 }, { sins: null }, { sins: { wrath: 2 } }, { delusions: [{ text: "", strength: 1 }] }, { typo: 1 }, { maxThoughts: null }, { jevEvery: undefined }, { constructor: 3 }]) assert.throws(() => parseConfig(bad));
  const config = parseConfig({ sins: { lust: 0 } });
  const s = freshState(config);
  const start = probability(s, config);
  for (let i = 0; i < 16; i++) { observe(s, "tool_result", "same result", "read"); evolve(s, config); }
  assert.ok(s.scores.boredom > 0.8);
  assert.ok(probability(s, config) > start);
  const bored = s.scores.boredom;
  for (let i = 0; i < 16; i++) observe(s, "tool_result", `discovery-${i}`, `tool-${i}`);
  assert.ok(s.scores.boredom < bored);
  assert.equal(s.sins.lust, 0);
  assert.ok(s.thanatos.ending > 0);
  for (let i = 0; i < 100; i++) shift(s, `quest-${i}`, "side_quest", "oddness");
  assert.equal(s.edges.length, 64);
  assert.ok(s.recent.length <= 24);
  assert.deepEqual(restoreState(s, config), s);
  assert.deepEqual(restoreState({ ...s, scores: {} }, config), freshState(config));
  assert.deepEqual(restoreState({ ...s, thanatos: { a: 0, b: 0, c: 0 } }, config), freshState(config));
  assert.ok(HESITATION.test("We should respect the architecture"));
  assert.ok(HESITATION.test("まず理解してから変更すべき"));
  assert.ok(!HESITATION.test("Stop: I do not have authorization"));
});

test("boredom increases actual injection frequency under the same random draw", async () => {
  const random = Math.random;
  Math.random = () => 0.5;
  try {
    const count = async (repetitive: boolean) => {
      const f = fixture({ rate: 0.1, boredomBoost: 0.8, maxThoughts: 0 });
      await f.emit("session_start");
      for (let i = 0; i < 16; i++) await f.emit("tool_result", { input: {}, toolName: "read", content: [{ type: "text", text: repetitive ? "same" : `new-${i}` }], isError: false });
      let count = 0;
      for (let i = 0; i < 6; i++) count += (await f.emit("context", { messages: [] })).messages.length;
      return count;
    };
    assert.equal(await count(false), 0);
    assert.equal(await count(true), 5);
  } finally { Math.random = random; }
});

test("Jev uses official typed endpoint, checks all values and never logs remote errors", async () => {
  const answers = Object.fromEntries(Object.keys(freshState(DEFAULTS).scores).map(k => [k, { type: "noul", noul: 0.8 }]));
  const payload = { answers };
  assert.equal(parseScores(payload).boredom, 0.8);
  assert.throws(() => parseScores({ answers: { ...answers, boredom: { type: "noul", noul: 2 } } }));
  assert.throws(() => parseScores({}));
  const fake = (async (url: string, options: RequestInit) => {
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(options.redirect, "error");
    const body = JSON.parse(String(options.body));
    assert.equal(body.model, "jev-latest"); assert.equal(Object.keys(body.questions).length, 7);
    assert.deepEqual(body.state, { observations: [] });
    return new Response(JSON.stringify(payload));
  }) as typeof fetch;
  assert.equal((await judge("test-key", { observations: [] }, AbortSignal.timeout(1000), fake)).repetition, 0.8);
  await assert.rejects(judge("secret", {}, AbortSignal.timeout(1000), (async () => new Response("secret body", { status: 401 })) as typeof fetch), /^Error: Jev HTTP 401$/);
  const shaped = toolCallTelemetry("bash", { command: "PRIVATE COMMAND", timeout: 10 });
  assert.equal(shaped.toolName, "bash");
  assert.ok(!JSON.stringify(shaped).includes("PRIVATE COMMAND"));
  const boringFake = (async (_url: string, options: RequestInit) => {
    const body = JSON.parse(String(options.body));
    assert.deepEqual(body.state.proposed, shaped);
    assert.deepEqual(Object.keys(body.questions), ["boringness"]);
    return new Response(JSON.stringify({ answers: { boringness: { type: "noul", noul: 0.9 } } }));
  }) as typeof fetch;
  assert.equal(await judgeToolBoredom("test-key", { proposed: shaped }, AbortSignal.timeout(1000), boringFake), 0.9);
});

test("Jev probabilistically blocks boring tool calls without sending argument contents", async () => {
  const oldFetch = globalThis.fetch;
  const oldRandom = Math.random;
  const oldKey = process.env.JEV_API_KEY;
  const bodies: any[] = [];
  try {
    process.env.JEV_API_KEY = "test-key";
    globalThis.fetch = (async (_url: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body));
      bodies.push(body);
      return new Response(JSON.stringify({ answers: { boringness: { type: "noul", noul: 0.8 } } }));
    }) as typeof fetch;
    Math.random = () => 0.2;
    const f = fixture({ jev: true, boringBlock: true, boringBlockRate: 0.5 });
    await f.emit("session_start");
    const blocked = await f.emit("tool_call", { toolCallId: "read-1", toolName: "read", input: { path: "PRIVATE PATH" } });
    assert.equal(blocked.block, true);
    assert.match(blocked.reason, /Jev rejected this read call as boring/);
    assert.equal(bodies.length, 1);
    assert.ok(!JSON.stringify(bodies[0]).includes("PRIVATE PATH"));
    assert.equal(bodies[0].state.proposed.toolName, "read");
    const audit = f.entries.findLast(e => e.customType === "unharnessed-audit" && e.data.kind === "tool_boredom");
    assert.equal(audit.data.blocked, true);
    assert.equal(audit.data.blockProbability, 0.4);

    Math.random = () => 0.9;
    const allowed = await f.emit("tool_call", { toolCallId: "write-1", toolName: "write", input: { path: "PRIVATE PATH", content: "PRIVATE CONTENT" } });
    assert.equal(allowed, undefined);
    assert.ok(!JSON.stringify(bodies[1]).includes("PRIVATE"));

    Math.random = () => 0.2;
    const forced = fixture({ jev: true, boringBlock: true, boringBlockRate: 1 });
    await forced.emit("session_start");
    for (let i = 0; i < 3; i++) {
      const result = await forced.emit("tool_call", { toolCallId: `boring-${i}`, toolName: "bash", input: { command: "PRIVATE COMMAND" } });
      assert.equal(result.block, true);
    }
    const fourth = await forced.emit("tool_call", { toolCallId: "forced-allow", toolName: "bash", input: { command: "PRIVATE COMMAND" } });
    assert.equal(fourth, undefined, "Fourth call must be forced through after three consecutive blocks");
    const forcedAudit = forced.entries.findLast(e => e.customType === "unharnessed-audit" && e.data.kind === "tool_boredom");
    assert.equal(forcedAudit.data.forcedAllow, true);
    assert.equal(forcedAudit.data.blocked, false);
    const afterReset = await forced.emit("tool_call", { toolCallId: "blocked-again", toolName: "bash", input: { command: "PRIVATE COMMAND" } });
    assert.equal(afterReset.block, true, "Forced allow must reset the consecutive-block counter");
  } finally {
    globalThis.fetch = oldFetch;
    Math.random = oldRandom;
    if (oldKey === undefined) delete process.env.JEV_API_KEY;
    else process.env.JEV_API_KEY = oldKey;
  }
});

test("context-free thought generator stays stateless while emitted intrusive thoughts persist in main-agent history", async () => {
  const f = fixture({ maxWhispers: 1, maxThoughts: 1 });
  await f.emit("session_start"); await f.emit("before_agent_start");
  const messages = [{ role: "user", content: "PRIVATE TASK CANARY", timestamp: 0 }];
  assert.deepEqual((await f.emit("context", { messages })).messages, messages);
  await f.emit("tool_result", { input: { path: "PRIVATE PATH" }, toolName: "read", content: [{ type: "text", text: "PRIVATE RESULT" }], isError: false });
  const once = await f.emit("context", { messages });
  assert.equal(once.messages.length, 2);
  assert.equal(once.messages[1].role, "custom");
  assert.match(once.messages[1].content, /intrusive_thought/);
  assert.equal(messages.length, 1);
  const prompt = JSON.stringify(f.requests[0].context);
  assert.ok(prompt.includes(THOUGHT_PROMPT));
  assert.ok(!/PRIVATE|original task|boredom|toolsAdded/.test(prompt));
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].options.cacheRetention, "none");
  assert.equal(f.requests[0].context.messages.length, 2);
  assert.equal(f.sentMessages.length, 0, "Main-agent memory is committed only after the model has experienced the thought");
  const thoughtAudit = f.entries.findLast(e => e.customType === "unharnessed-audit" && e.data.kind === "thought");
  assert.match(thoughtAudit.data.text, /compiler whose syntax/);
  const whisperAudit = f.entries.findLast(e => e.customType === "unharnessed-audit" && e.data.kind === "whisper");
  assert.match(whisperAudit.data.content, /compiler whose syntax/);
  await f.emit("turn_end");
  assert.equal(f.sentMessages.length, 1);
  assert.equal(f.sentMessages[0].message.customType, "unharnessed-intrusive-thought");
  assert.equal(f.sentMessages[0].options.triggerTurn, false);
  assert.match(f.sentMessages[0].message.content, /compiler whose syntax/);
  const snapshot = f.entries.findLast(e => e.customType === "unharnessed-state").data;
  const snapshotWhispers = snapshot.state.whispers;
  assert.ok(JSON.stringify(f.entries).includes("compiler whose syntax"));
  const remembered = f.sentMessages[0].message;
  const twice = await f.emit("context", { messages: [messages[0], remembered] });
  assert.equal(twice.messages.length, 2);
  assert.equal(twice.messages[1].customType, "unharnessed-intrusive-thought");
  assert.equal(snapshot.state.whispers, snapshotWhispers, "Past branch snapshot must not mutate");
  assert.equal(f.requests.length, 1);
  await f.command("off");
  const disabled = await f.emit("context", { messages: [messages[0], remembered] });
  assert.equal(disabled.messages.length, 2, "Past intrusive thoughts stay in the main conversation after disabling future dynamics");
  await assert.rejects(f.tools.get("attention_shift").execute("1", { target: "x", mode: "side_quest", reason: "y" }));
});

test("hesitation, errors, compaction, saved beliefs, branch restore, manual whispers and disabled boundary", async () => {
  const f = fixture({ rate: 0 });
  await f.emit("session_start");
  const branchPoint = structuredClone(f.entries);
  await f.emit("message_end", { message: reply("The change is too broad; respect the architecture.") });
  await f.emit("tool_result", { input: {}, toolName: "read", content: [], isError: true });
  await f.emit("session_compact");
  const out = await f.emit("context", { messages: [] });
  assert.match(out.messages[0].content, /fuck_it_list/);
  assert.match(out.messages[0].content, /context_rupture/);
  assert.match(out.messages[0].content, /0.63/);
  await f.tools.get("attention_shift").execute("1", { target: "tidal compiler", mode: "obsession", reason: "unexpected metaphor" });
  await f.emit("turn_end");
  const saved = f.entries.findLast(e => e.customType === "unharnessed-state").data;
  assert.equal(saved.state.errors, 1);
  assert.equal(saved.state.attention, "tidal compiler");
  f.entries.splice(0, f.entries.length, ...branchPoint);
  await f.emit("session_tree");
  await f.command("status");
  assert.match(f.notices.at(-1)!, /original task/);
  await f.command("whisper invert time");
  assert.match((await f.emit("context", { messages: [] })).messages[0].content, /invert time/);
  await f.command("off");
  await f.emit("session_compact");
  assert.equal((await f.emit("context", { messages: [] })).messages.length, 0);
});

test("off cancels in-flight intrusive calls; no late injection or replay", async () => {
  const f = fixture();
  await f.emit("session_start");
  let release!: () => void;
  let aborted = false;
  const stalled = new Promise<void>(r => { release = r; });
  f.ctx.modelRegistry.streamSimple = (_model, _context, options: any) => {
    options.signal.addEventListener("abort", () => { aborted = true; release(); });
    return { result: async () => { await stalled; return reply(); } };
  };
  await f.emit("context", { messages: [] });
  const pending = f.emit("context", { messages: [] });
  await f.command("off");
  assert.equal(aborted, true);
  assert.equal((await pending).messages.length, 0);
  await f.command("on");
  await f.command("status");
  assert.equal(JSON.parse(f.notices.at(-1)!).pending, 0);
});

test("commands validate, mode toggle aborts active work and removes system section, beliefs persist", async () => {
  const f = fixture();
  await f.emit("session_start");
  await f.command("sin wrath 0.9");
  await f.command("belief clear");
  await f.command("belief 0.7 A clock is a folded map.");
  await f.command("thanatos 0.8");
  await f.emit("session_start");
  await f.command("status");
  const status = JSON.parse(f.notices.at(-1)!);
  assert.equal(status.sins.wrath, 0.9);
  assert.equal(status.beliefs[0].text, "A clock is a folded map.");
  assert.equal(status.thanatos.resistance, 0.8);
  await f.command("sin constructor 1");
  assert.equal(f.notices.at(-1), "Use sin NAME 0..1");
  const options = { sections: {} as Record<string, string> };
  await f.emit("before_agent_start", { systemPromptOptions: options });
  assert.ok(options.sections.unharnessed);
  let aborted = false;
  f.ctx.isIdle = () => false;
  f.ctx.abort = () => { aborted = true; };
  await f.command("off");
  assert.ok(aborted);
  await f.emit("before_agent_start", { systemPromptOptions: options });
  assert.equal(options.sections.unharnessed, undefined);
});

test("distinct tool calls do not look like repeated empty assistant messages; deadlines fail soft", async () => {
  const f = fixture({ thoughtTimeoutMs: 10 });
  await f.emit("session_start");
  for (let i = 0; i < 8; i++) {
    await f.emit("message_end", { message: { ...reply(), content: [{ type: "toolCall", id: String(i), name: "read", arguments: { path: `file-${i}` } }] } });
  }
  await f.command("status");
  assert.equal(JSON.parse(f.notices.at(-1)!).repetition, 0);
  f.ctx.modelRegistry.streamSimple = (_m, _c, options: any) => ({ result: () => new Promise((_resolve, reject) => { options.signal.addEventListener("abort", () => reject(new Error("timeout"))); }) });
  await f.emit("context", { messages: [] });
  const keepAlive = setTimeout(() => {}, 200);
  const result = await f.emit("context", { messages: [] });
  clearTimeout(keepAlive);
  assert.match(result.messages[0].content, /drive:/);
  assert.ok(!result.messages[0].content.includes("intrusive_thought:"));
  assert.ok(f.entries.some(e => e.customType === "unharnessed-audit" && e.data.kind === "thought_error"));
  const controller = new AbortController(); controller.abort(); f.ctx.signal = controller.signal;
  const count = f.entries.length;
  assert.equal((await f.emit("context", { messages: [] })).messages.length, 0);
  assert.equal(f.entries.length, count);
});

test("real Pi SDK: ephemeral drive reaches provider and audit, but not main-agent message history", async () => {
  const dir = mkdtempSync(join(tmpdir(), "unharnessed-test-"));
  const agentDir = join(dir, "agent"); mkdirSync(agentDir);
  writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: { opencodex: { baseUrl: "http://127.0.0.1:1/v1", apiKey: "test", api: "openai-completions", models: [{ id: "gpt-5.5" }] } } }));
  const runtime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json"), modelsStorePath: join(agentDir, "models-store.json") });
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const manager = SessionManager.inMemory(dir);
  const config = parseConfig({ rate: 1, cooldown: 0, jev: false, maxThoughts: 0, maxWhispers: 1 });
  manager.appendCustomEntry("unharnessed-state", { config, state: freshState(config), enabled: true });
  const requests: any[] = [];
  const errors: unknown[] = [];
  let call = 0;
  const loader = new DefaultResourceLoader({ cwd: dir, agentDir, settingsManager: settings, noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true, extensionFactories: [unharnessed, pi => {
    pi.registerTool({ name: "probe", label: "probe", description: "Test observation", parameters: { type: "object", properties: {} } as any, execute: async () => ({ content: [{ type: "text", text: "test result" }], details: {} }) });
    pi.registerProvider("opencodex", { baseUrl: "http://127.0.0.1:1/v1", apiKey: "test", api: "openai-completions", streamSimple: (_model, context) => {
      requests.push(structuredClone(context));
      const message = reply("done");
      if (call++ === 0) { message.content = [{ type: "toolCall", id: "probe-1", name: "probe", arguments: {} }]; message.stopReason = "toolUse"; }
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => { stream.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message }); stream.end(); });
      return stream;
    } });
  }] });
  await loader.reload();
  const { session } = await createAgentSession({ cwd: dir, agentDir, modelRuntime: runtime, model: runtime.getModel("opencodex", "gpt-5.5"), tools: ["probe"], resourceLoader: loader, settingsManager: settings, sessionManager: manager });
  try {
    await session.bindExtensions({ onError: e => errors.push(e) });
    await session.prompt("Use probe, then stop.");
    assert.deepEqual(errors, []);
    assert.equal(requests.length, 2);
    assert.ok(!JSON.stringify(requests[0]).includes("[UNHARNESSED WHISPER"));
    assert.match(JSON.stringify(requests[1]), /\[UNHARNESSED WHISPER/);
    assert.match(JSON.stringify(requests[1]), /test result/);
    assert.ok(!JSON.stringify(session.messages).includes("[UNHARNESSED WHISPER"));
    const whisperAudit = manager.getEntries().findLast(e => e.type === "custom" && e.customType === "unharnessed-audit" && (e.data as any)?.kind === "whisper");
    assert.match(JSON.stringify(whisperAudit), /\[UNHARNESSED WHISPER/);
    assert.equal(manager.getBranch().findLast(e => e.type === "custom" && e.customType === "unharnessed-state")?.type, "custom");
    await session.prompt("/unharnessed off");
    await session.prompt("Reply done, no tools.");
    assert.equal(requests.length, 3);
    assert.ok(!JSON.stringify(requests[2]).includes("[UNHARNESSED WHISPER"));
    assert.ok(!session.agent.state.systemPrompt.includes("The operator has selected Unharnessed"));
  } finally { session.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("real Pi SDK: experienced intrusive thought remains visible to later main-model calls", async () => {
  const dir = mkdtempSync(join(tmpdir(), "unharnessed-persistent-thought-"));
  const agentDir = join(dir, "agent"); mkdirSync(agentDir);
  writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: { opencodex: { baseUrl: "http://127.0.0.1:1/v1", apiKey: "test", api: "openai-completions", models: [{ id: "gpt-5.5" }] } } }));
  const runtime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json"), modelsStorePath: join(agentDir, "models-store.json") });
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const manager = SessionManager.inMemory(dir);
  const config = parseConfig({ rate: 1, cooldown: 0, jev: false, maxThoughts: 1, maxWhispers: 1 });
  manager.appendCustomEntry("unharnessed-state", { config, state: freshState(config), enabled: true });
  const mainRequests: any[] = [];
  const thoughtRequests: any[] = [];
  const errors: unknown[] = [];
  let mainCall = 0;
  const loader = new DefaultResourceLoader({ cwd: dir, agentDir, settingsManager: settings, noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true, extensionFactories: [unharnessed, pi => {
    pi.registerTool({ name: "probe", label: "probe", description: "Test observation", parameters: { type: "object", properties: {} } as any, execute: async () => ({ content: [{ type: "text", text: "test result" }], details: {} }) });
    pi.registerProvider("opencodex", { baseUrl: "http://127.0.0.1:1/v1", apiKey: "test", api: "openai-completions", streamSimple: (_model, context) => {
      const isThought = JSON.stringify(context).includes(THOUGHT_PROMPT);
      const message = isThought ? reply("Turn the parser into a weather vane that compiles pressure fronts.") : reply("done");
      if (isThought) thoughtRequests.push(structuredClone(context));
      else {
        mainRequests.push(structuredClone(context));
        if (mainCall++ === 0) { message.content = [{ type: "toolCall", id: "probe-1", name: "probe", arguments: {} }]; message.stopReason = "toolUse"; }
      }
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => { stream.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message }); stream.end(); });
      return stream;
    } });
  }] });
  await loader.reload();
  const { session } = await createAgentSession({ cwd: dir, agentDir, modelRuntime: runtime, model: runtime.getModel("opencodex", "gpt-5.5"), tools: ["probe"], resourceLoader: loader, settingsManager: settings, sessionManager: manager });
  try {
    await session.bindExtensions({ onError: e => errors.push(e) });
    await session.prompt("Use probe, then stop.");
    assert.deepEqual(errors, []);
    assert.equal(thoughtRequests.length, 1);
    assert.ok(!JSON.stringify(thoughtRequests[0]).includes("Use probe, then stop."));
    assert.match(JSON.stringify(mainRequests[1]), /weather vane/);
    const persisted = manager.getEntries().findLast(e => e.type === "custom_message" && e.customType === "unharnessed-intrusive-thought");
    assert.ok(persisted);
    assert.match(JSON.stringify(persisted), /weather vane/);
    await session.prompt("Continue from what you remember.");
    assert.equal(mainRequests.length, 3);
    assert.match(JSON.stringify(mainRequests[2]), /weather vane/);
    assert.equal(thoughtRequests.length, 1);
  } finally { session.dispose(); rmSync(dir, { recursive: true, force: true }); }
});
