import { createServer, connect } from "node:net";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// OpenCodex's loopback mode requires a loopback Host header. A local TCP forward
// preserves that header without exposing a listener or changing the host service.
const upstream = process.env.OPENCODEX_HOST ?? "host.docker.internal";
const sockets = new Set<import("node:net").Socket>();
const server = createServer(local => {
  sockets.add(local);
  local.on("close", () => sockets.delete(local));
  const remote = connect(10100, upstream);
  remote.setTimeout(120000, () => remote.destroy());
  remote.on("error", () => local.destroy());
  local.on("error", () => remote.destroy());
  local.on("close", () => remote.destroy());
  remote.on("close", () => local.destroy());
  local.pipe(remote).pipe(local);
});
server.listen(10100, "127.0.0.1");
await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
const agentDir = "/tmp/unharnessed-agent";
await mkdir(agentDir, { recursive: true, mode: 0o700 });
const config = JSON.parse(await readFile(new URL("../examples/models.json", import.meta.url), "utf8"));
config.providers.opencodex.baseUrl = "http://127.0.0.1:10100/v1";
await writeFile(`${agentDir}/models.json`, JSON.stringify(config), { mode: 0o600 });
const base = fileURLToPath(new URL("../", import.meta.url));
const lab = process.argv[2] === "--compare";
const args = lab ? [`${base}scripts/compare.ts`] : [
  `${base}node_modules/@earendil-works/pi-coding-agent/dist/cli.js`,
  "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-themes",
  "-e", `${base}src/index.ts`, "--provider", "opencodex", "--model", process.env.LAB_MODEL ?? "gpt-5.5", ...process.argv.slice(2),
];
const child = spawn(process.execPath, args, { stdio: "inherit", env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, ...(lab ? { UNHARNESSED_LAB: "1" } : {}) } });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
const close = (code: number) => {
  for (const socket of sockets) socket.destroy();
  server.close(); process.exitCode = code;
};
child.on("error", () => close(1));
child.on("exit", code => close(code ?? 1));
