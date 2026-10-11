import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type {
  LogEntry,
  Snapshot,
  StatusComponent,
  StatusReport,
} from "../shared/types.js";
export class Journal {
  private rows: LogEntry[] = [];
  private sequence = 0;
  add(message: string, level: LogEntry["level"] = "info") {
    this.rows.push({ id: ++this.sequence, time: Date.now(), level, message });
    if (this.rows.length > 200) this.rows.shift();
  }
  list() {
    return [...this.rows];
  }
}
export function botStatus(
  name: string,
  id: string,
  state: Snapshot,
  lane: "A" | "B",
): StatusComponent {
  const bot = state.lanes[lane];
  return {
    name,
    id,
    status:
      state.mode === "demo"
        ? "demo"
        : bot.status === "error" || bot.status === "reconnecting"
          ? "degraded"
          : !state.validated || !bot.botOnline
            ? "unknown"
            : bot.status === "listening"
              ? "healthy"
              : "idle",
  };
}
const historySchema = z
  .array(
    z.object({
      time: z.number(),
      status: z.enum(["healthy", "unknown", "degraded"]),
    }),
  )
  .max(10080);
export class StatusMonitor {
  readonly started = Date.now();
  private history: StatusReport["history"] = [];
  private requests = 0;
  private failures = 0;
  private lastLatency: number | null = null;
  private queue: Promise<void> = Promise.resolve();
  constructor(
    private directory = join(process.env.LOCALAPPDATA ?? ".", "PulseMic"),
  ) {}
  async load() {
    try {
      this.history = historySchema.parse(
        JSON.parse(
          await readFile(join(this.directory, "status-history.json"), "utf8"),
        ),
      );
    } catch {}
  }
  observe(code: number, latency: number) {
    this.requests++;
    if (code >= 500) this.failures++;
    this.lastLatency = Math.round(latency);
  }
  report(components: StatusComponent[]): StatusReport {
    return {
      updated: Date.now(),
      started: this.started,
      components,
      history: [...this.history],
      requests: this.requests,
      failures: this.failures,
      lastLatency: this.lastLatency,
    };
  }
  sample(components: StatusComponent[]) {
    const status: "healthy" | "unknown" | "degraded" = components.some(
      (c) => c.status === "degraded",
    )
      ? "degraded"
      : components.some((c) => c.status === "unknown" || c.status === "demo")
        ? "unknown"
        : "healthy";
    const now = Date.now();
    this.history = [
      ...this.history.filter((row) => row.time > now - 7 * 86400000),
      { time: now, status },
    ].slice(-10080);
    const data = JSON.stringify(this.history);
    const work = this.queue.then(async () => {
      await mkdir(this.directory, { recursive: true });
      const target = join(this.directory, "status-history.json");
      await writeFile(target + ".tmp", data);
      await rename(target + ".tmp", target);
    });
    this.queue = work.catch(() => {});
    return work;
  }
}
