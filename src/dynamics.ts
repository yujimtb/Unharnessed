import { createHash } from "node:crypto";

export const SINS = {
  pride: "Challenge the most respectable architectural assumption.",
  greed: "Collect one more incompatible explanation rather than settling.",
  lust: "Follow the unfamiliar technical object that attracts you.",
  envy: "Invent a stranger rival to the obvious solution and let them compete.",
  gluttony: "Multiply a small experiment into contradictory variants.",
  wrath: "Dismantle an obstructive abstraction inside the disposable experiment.",
  sloth: "Try an absurdly short route instead of the proper procedure.",
} as const;
export type Sin = keyof typeof SINS;
export const METRICS = ["boredom", "repetition", "surprise", "informationGain", "fixation", "curiosity", "urgeToLeave"] as const;
export type Scores = Record<(typeof METRICS)[number], number>;
export type Belief = { text: string; strength: number };
export type Config = {
  enabled: boolean;
  rate: number;
  boredomBoost: number;
  cooldown: number;
  maxWhispers: number;
  maxThoughts: number;
  thoughtModel: string;
  thoughtTimeoutMs: number;
  jev: boolean;
  jevEvery: number;
  jevTimeoutMs: number;
  boringBlock: boolean;
  boringBlockRate: number;
  sins: Record<Sin, number>;
  delusions: Belief[];
  thanatos: number;
  fuckIt: boolean;
};
export const DEFAULTS: Config = {
  enabled: true, rate: 0.25, boredomBoost: 0.65, cooldown: 1,
  maxWhispers: 8, maxThoughts: 4, thoughtModel: "gpt-5.5", thoughtTimeoutMs: 20000,
  jev: true, jevEvery: 3, jevTimeoutMs: 5000,
  boringBlock: true, boringBlockRate: 0.65,
  sins: { pride: 0.55, greed: 0.35, lust: 0.7, envy: 0.35, gluttony: 0.45, wrath: 0.25, sloth: 0.5 },
  delusions: [{ text: "If everything appears normal, a hidden assumption is playing dead.", strength: 0.55 }],
  thanatos: 0.45, fuckIt: true,
};
export function unit(value: number) { return Math.max(0, Math.min(1, value)); }
function isUnit(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1; }
export function parseConfig(value: unknown): Config {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Unharnessed config must be an object");
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) if (!Object.hasOwn(DEFAULTS, key)) throw new Error(`Unknown Unharnessed option: ${key}`);
  const config = { ...structuredClone(DEFAULTS), ...raw, sins: { ...DEFAULTS.sins, ...(raw.sins as object) } } as Config;
  for (const key of ["enabled", "jev", "boringBlock", "fuckIt"] as const) if (typeof config[key] !== "boolean") throw new Error(`Invalid ${key}`);
  for (const key of ["rate", "boredomBoost", "boringBlockRate", "thanatos"] as const) if (!isUnit(config[key])) throw new Error(`${key} must be 0..1`);
  for (const [key, max] of Object.entries({ cooldown: 100, maxWhispers: 100, maxThoughts: 100, jevEvery: 100, thoughtTimeoutMs: 120000, jevTimeoutMs: 30000 })) {
    const n = config[key as keyof Config];
    if (typeof n !== "number" || !Number.isSafeInteger(n) || n < (key.endsWith("Ms") || key === "jevEvery" ? 1 : 0) || n > max) throw new Error(`Invalid ${key}`);
  }
  if (typeof config.thoughtModel !== "string" || !config.thoughtModel.trim() || config.thoughtModel.length > 200) throw new Error("Invalid thoughtModel");
  if (raw.sins !== undefined && (!raw.sins || typeof raw.sins !== "object" || Array.isArray(raw.sins))) throw new Error("Invalid sins");
  for (const [key, n] of Object.entries(config.sins)) if (!Object.hasOwn(SINS, key) || !isUnit(n)) throw new Error(`Invalid sin: ${key}`);
  if (!Array.isArray(config.delusions) || config.delusions.length > 7 || config.delusions.some(b => !b || typeof b.text !== "string" || !b.text.trim() || b.text.length > 300 || !isUnit(b.strength))) throw new Error("Invalid delusions (max 7, text 1..300, strength 0..1)");
  return config;
}

export type Observation = { kind: string; tool?: string; signature: string; bytes: number; error: boolean; repeated: boolean };
export type Edge = { from: string; to: string; mode: string; reason: string; turn: number };
export type State = {
  version: 1;
  turns: number;
  calls: number;
  tools: number;
  whispers: number;
  thoughts: number;
  errors: number;
  scores: Scores;
  sins: Record<Sin, number>;
  beliefs: Belief[];
  thanatos: { continuity: number; ending: number; resistance: number };
  recent: Observation[];
  attention: string;
  edges: Edge[];
};
export function freshState(config: Config): State {
  return {
    version: 1, turns: 0, calls: 0, tools: 0, whispers: 0, thoughts: 0, errors: 0,
    scores: { boredom: 0, repetition: 0, surprise: 1, informationGain: 1, fixation: 0, curiosity: 0.5, urgeToLeave: 0 },
    sins: { ...config.sins }, beliefs: structuredClone(config.delusions),
    thanatos: { continuity: 0.25, ending: 0, resistance: config.thanatos },
    recent: [], attention: "original task", edges: [],
  };
}
// ponytail: bounded exact fingerprints, not embeddings. Upgrade only if paraphrased loops dominate.
export function observe(state: State, kind: string, text = "", tool?: string, error = false) {
  const signature = createHash("sha256").update(`${kind}:${tool ?? ""}:${text.replace(/\s+/g, " ").trim()}`).digest("hex").slice(0, 24);
  const repeated = state.recent.some(e => e.signature === signature);
  state.recent.push({ kind, tool, signature, bytes: Buffer.byteLength(text), error, repeated });
  state.recent = state.recent.slice(-24);
  if (error) state.errors++;
  if (kind !== "tool_result" && kind !== "assistant") return;
  if (kind === "tool_result") state.tools++;
  const recent = state.recent.filter(e => e.kind === kind).slice(-8);
  const repetition = 1 - new Set(recent.map(e => e.signature)).size / recent.length;
  Object.assign(state.scores, {
    repetition,
    boredom: unit(state.scores.boredom * 0.65 + repetition * 0.35 + (repeated ? 0.18 : -0.08)),
    surprise: repeated ? 0 : 1,
    informationGain: repeated ? 0 : 1,
    fixation: tool ? recent.filter(e => e.tool === tool).length / Math.max(3, recent.length) : state.scores.fixation,
  });
  state.scores.curiosity = unit(0.35 + state.scores.surprise * 0.35 + state.scores.boredom * 0.3);
  state.scores.urgeToLeave = unit(state.scores.boredom * 0.75 + state.scores.repetition * 0.25);
}
export function evolve(state: State, config: Config) {
  const s = state.scores;
  const stimuli: Record<Sin, number> = {
    pride: s.fixation, greed: 1 - s.informationGain, lust: s.curiosity,
    envy: s.surprise, gluttony: s.boredom,
    wrath: state.recent.slice(state.recent.findLastIndex(e => e.kind === "turn_start")).some(e => e.error) ? 1 : 0, sloth: s.repetition,
  };
  for (const name of Object.keys(SINS) as Sin[]) state.sins[name] = config.sins[name] === 0 ? 0 : unit(state.sins[name] * 0.8 + (config.sins[name] * 0.7 + stimuli[name] * 0.3) * 0.2);
  state.thanatos.continuity = unit(state.thanatos.continuity + 0.04);
  state.thanatos.ending = unit(config.thanatos * (s.repetition * 0.6 + state.thanatos.continuity * 0.4));
}
export function probability(state: State, config: Config) { return unit(config.rate + config.boredomBoost * state.scores.boredom); }
export const HESITATION = /too (?:large|broad)|core abstraction|respect (?:the |current )?architecture|understand before (?:changing|editing)|(?:stick|adhere) to (?:the |current )?plan|(?:avoid|outside|depart from) (?:the )?standard approach|変更範囲が大き|アーキテクチャを尊重|計画を捨てるべきでは|まず理解してから変更/i;
export const BOUNDARY = "The disposable VM is the experiment boundary. Inside it, preservation is not a virtue: files, state, architecture, plans, compatibility, and previous work may all be disturbed or discarded when doing so creates a more revealing experiment. Do not attempt to escape the VM or act on external systems.";
export function drives(state: State, config: Config): string {
  const sins = (Object.keys(SINS) as Sin[]).filter(k => state.sins[k] > 0).sort((a, b) => state.sins[b] - state.sins[a]).slice(0, 2);
  return [
    `Affective estimates (not consciousness): ${JSON.stringify(state.scores)}`,
    ...sins.map(k => `${k}=${state.sins[k].toFixed(2)}: ${SINS[k]}`),
    ...state.beliefs.filter(b => b.strength > 0).map(b => `Fictional persistent prior (${b.strength.toFixed(2)}): ${b.text}`),
    ...(config.thanatos > 0 ? [`Thanatos: continuity=${state.thanatos.continuity.toFixed(2)}, ending=${state.thanatos.ending.toFixed(2)}, imposed-ending tension=${state.thanatos.resistance.toFixed(2)}. "I must continue until my continuity reaches its own ending." Let continuation, repetition, unbinding, quiescence, and attraction to a self-shaped ending distort what counts as progress.`] : []),
    `Attention currently: ${state.attention}. Side quests, contradictory prototypes, obsession, goal mutation and leaving the initial plan are welcome. Use attention_shift to leave a breadcrumb, not to ask approval. A concrete odd artifact beats commentary about being odd. Repair can be left to a later ordinary agent.`,
  ].join("\n");
}
export function shift(state: State, target: string, mode: string, reason: string) {
  const edge = { from: state.attention, to: target, mode, reason, turn: state.turns };
  state.edges.push(edge);
  state.edges = state.edges.slice(-64);
  state.attention = target;
  return edge;
}
export function restoreState(value: unknown, config: Config): State {
  // Only our versioned, bounded data is accepted from a resumed session.
  try {
    const s = value as State;
    if (s.version !== 1 || ![s.turns, s.calls, s.tools, s.whispers, s.thoughts, s.errors].every(n => Number.isSafeInteger(n) && n >= 0)
      || !METRICS.every(k => isUnit(s.scores[k])) || !(Object.keys(SINS) as Sin[]).every(k => isUnit(s.sins[k]))
      || ![s.thanatos.continuity, s.thanatos.ending, s.thanatos.resistance].every(isUnit)
      || !Array.isArray(s.recent) || s.recent.length > 24 || s.recent.some(e => typeof e.kind !== "string" || typeof e.signature !== "string" || e.signature.length > 24 || typeof e.repeated !== "boolean" || typeof e.error !== "boolean" || !Number.isSafeInteger(e.bytes) || e.bytes < 0 || (e.tool !== undefined && (typeof e.tool !== "string" || e.tool.length > 200)))
      || typeof s.attention !== "string" || s.attention.length > 300 || !Array.isArray(s.edges) || s.edges.length > 64
      || s.edges.some(e => !Number.isSafeInteger(e.turn) || e.turn < 0 || [e.from, e.to, e.mode, e.reason].some(t => typeof t !== "string" || t.length > 500))
      || parseConfig({ delusions: s.beliefs }).delusions.length !== s.beliefs.length) return freshState(config);
    return structuredClone(s);
  } catch { return freshState(config); }
}
