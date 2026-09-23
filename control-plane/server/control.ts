import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { DEFAULTS, parseConfig, type Config } from "../../src/dynamics.ts";
import type { UnharnessedControlPatch } from "../../src/index.ts";

export type DesiredControl = { enabled: boolean; config: Config; revision: number; updatedAt: string };

const ROOT = resolve(import.meta.dirname, "../..");
const DEFAULT_FILE = resolve(process.env.UNHARNESSED_CONTROL_FILE ?? join(ROOT, ".local", "unharnessed-control-plane.json"));

export class ControlHub {
  private desired: DesiredControl = {
    enabled: true,
    config: structuredClone(DEFAULTS),
    revision: 0,
    updatedAt: new Date(0).toISOString(),
  };
  private listeners = new Set<(patch: UnharnessedControlPatch) => void>();

  constructor(private readonly file = DEFAULT_FILE) {}

  async load() {
    try {
      const raw = JSON.parse(await readFile(this.file, "utf8")) as Partial<DesiredControl>;
      this.desired = {
        enabled: raw.enabled !== false,
        config: parseConfig(raw.config ?? {}),
        revision: Number.isSafeInteger(raw.revision) ? Number(raw.revision) : 0,
        updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(),
      };
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
      await this.persist();
    }
    return this.snapshot();
  }

  snapshot(): DesiredControl {
    return structuredClone(this.desired);
  }

  extensionPatch(): UnharnessedControlPatch {
    return { enabled: this.desired.enabled, config: structuredClone(this.desired.config) };
  }

  subscribe(listener: (patch: UnharnessedControlPatch) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async hydrate(remote: Partial<DesiredControl>): Promise<DesiredControl> {
    const config = parseConfig(remote.config ?? this.desired.config);
    this.desired = {
      enabled: remote.enabled ?? this.desired.enabled,
      config: structuredClone(config),
      revision: Number.isSafeInteger(remote.revision) ? Number(remote.revision) : this.desired.revision,
      updatedAt: typeof remote.updatedAt === "string" ? remote.updatedAt : new Date().toISOString(),
    };
    await this.persist();
    const effectivePatch = this.extensionPatch();
    for (const listener of this.listeners) listener(effectivePatch);
    return this.snapshot();
  }

  async update(patch: UnharnessedControlPatch): Promise<DesiredControl> {
    const nextConfig = patch.config
      ? parseConfig({
          ...this.desired.config,
          ...patch.config,
          sins: { ...this.desired.config.sins, ...(patch.config.sins ?? {}) },
        })
      : this.desired.config;

    this.desired = {
      enabled: patch.enabled ?? this.desired.enabled,
      config: structuredClone(nextConfig),
      revision: this.desired.revision + 1,
      updatedAt: new Date().toISOString(),
    };

    await this.persist();
    const effectivePatch = this.extensionPatch();
    for (const listener of this.listeners) listener(effectivePatch);
    return this.snapshot();
  }

  private async persist() {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(this.desired, null, 2) + "\n", "utf8");
  }
}
