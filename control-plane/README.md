# Unharnessed Control Plane

Interactive console for the Unharnessed Pi extension.

The browser uses **assistant-ui** with the **AG-UI** runtime. The gateway runs a persistent Pi session per AG-UI thread, streams model text/tool activity plus Unharnessed events, and optionally mirrors each run to **Opik**.

## What is streamed

A run at `POST /api/agent` emits AG-UI/SSE events in execution order:

- `TEXT_MESSAGE_*` — main model output
- `TOOL_CALL_*` — Pi tool calls and results
- `CUSTOM: jev_decision` — tool preflight boringness/block decision
- `CUSTOM: jev_state` — Jev state estimate
- `CUSTOM: intrusive_thought` — context-free thought generator output
- `CUSTOM: whisper` — exact emitted whisper
- `CUSTOM: attention_shift` — attention breadcrumbs
- `STATE_SNAPSHOT` — current Unharnessed config/state
- `CUSTOM: unharnessed_state` — compact state card for the transcript

The same harness events are written as Opik spans when Opik is configured. The desired control state is also versioned in an Opik prompt named `unharnessed-control`: the intrusive-thought prompt is the prompt body and the complete validated control object is stored in prompt metadata. The gateway pulls it at startup and pushes a new version after GUI control changes.

## Start

From the repository root:

```bash
cd control-plane
npm ci
cd ..
npm run control:dev
```

Open `http://127.0.0.1:5174`.

The Vite frontend proxies `/api/*` to the gateway at `http://127.0.0.1:8787`.

The gateway reuses the Pi model registry in `%USERPROFILE%\.pi\agent` by default. Override with:

```dotenv
PI_CODING_AGENT_DIR=C:\path\to\.pi\agent
UNHARNESSED_MAIN_PROVIDER=opencodex
UNHARNESSED_MAIN_MODEL=gpt-5.5
UNHARNESSED_MAIN_THINKING=low
```

For Jev:

```dotenv
JEV_API_KEY_FILE=D:\path\to\jev_api_key.txt
# or JEV_API_KEY=...
```

For Opik self-hosted:

```dotenv
OPIK_ENABLED=1
OPIK_URL_OVERRIDE=http://127.0.0.1:5173/api
OPIK_PROJECT_NAME=Unharnessed
```

For Comet-hosted Opik also set `OPIK_API_KEY` and `OPIK_WORKSPACE`. Set `UNHARNESSED_OPIK_CONTROL_PROMPT` to use a different control prompt name.

The Opik SDK reads `OPIK_URL_OVERRIDE`, `OPIK_API_KEY`, `OPIK_PROJECT_NAME`, and `OPIK_WORKSPACE` directly.

## Controls

The right panel writes desired state to `.local/unharnessed-control-plane.json`.

Changes are hot-applied to all running Unharnessed extension instances through the control bridge. Current controls include:

- emission rate / boredom boost / cooldown
- max whispers / max intrusive-thought attempts
- Jev enable, preflight blocking rate, judge interval, forced-allow threshold
- all Seven Sins baselines
- Thanatos and Fuck It
- intrusive-thought model
- intrusive-thought system prompt

Runtime values are streamed back separately, so the UI can show configured baselines beside evolving state.

## API

`GET /api/health`
: Pi/model availability, Opik status, desired control state.

`GET /api/state`
: desired state plus latest runtime state.

`PATCH /api/control`
: hot-update any validated Unharnessed config field.

`GET /api/live`
: SSE stream of runtime state/events independent of a chat run.

`POST /api/agent`
: AG-UI-compatible run endpoint.

`POST /api/thread/:threadId/abort`
: abort the active Pi run in that thread.

`POST /api/opik/push`
: create a new Opik control-prompt version from the current local desired state.

`POST /api/opik/pull`
: pull the current Opik control-prompt version and hot-apply it locally.

## Verification

```bash
npm run control:check
npm run control:build
npm test
```

A live smoke run has been verified against the configured OpenCodex model: the SSE stream emitted a Pi `TOOL_CALL_START`, then `CUSTOM intrusive_thought`, then `CUSTOM whisper`, followed by streamed assistant text and state snapshots.
