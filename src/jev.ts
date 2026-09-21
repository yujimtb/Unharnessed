import { METRICS, type Scores } from "./dynamics.ts";

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const questions = Object.fromEntries(Object.entries({
  boredom: "Is the agent making monotonous progress with little novelty?",
  repetition: "Is the agent repeating the same action or result?",
  surprise: "Did the recent action produce an unexpected result?",
  informationGain: "Did the recent action add new information?",
  fixation: "Is the agent stuck on one technique or object?",
  curiosity: "Does the trajectory suggest exploratory curiosity?",
  urgeToLeave: "Would switching exploration direction relieve this repetitive trajectory?",
}).map(([name, instructions]) => [name, { type: "noul", instructions }]));

export function parseScores(payload: unknown): Scores {
  const answers = (payload as { answers?: Record<string, { type?: string; noul?: number }> })?.answers;
  const scores = {} as Scores;
  for (const name of METRICS) {
    const answer = answers?.[name];
    if (answer?.type !== "noul" || typeof answer.noul !== "number" || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) throw new Error(`Invalid Jev answer: ${name}`);
    scores[name] = answer.noul;
  }
  return scores;
}
export async function judge(apiKey: string, state: unknown, signal: AbortSignal, request: typeof fetch = fetch): Promise<Scores> {
  // Send bounded structural telemetry, never tool text, paths, conversation or credentials.
  const response = await request(JEV_ENDPOINT, {
    method: "POST", redirect: "error", signal,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "jev-latest", state, questions }),
  });
  if (!response.ok) throw new Error(`Jev HTTP ${response.status}`); // No remote body in logs.
  return parseScores(await response.json());
}
