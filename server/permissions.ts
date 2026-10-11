import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
export const ownerId = "1456945476933914626";
const schema = z.array(z.string().regex(/^\d{17,20}$/)).max(100);
export class Permissions {
  private users = new Set<string>();
  private queue: Promise<void> = Promise.resolve();
  constructor(
    private directory = join(process.env.LOCALAPPDATA ?? ".", "PulseMic"),
  ) {}
  async load() {
    try {
      this.users = new Set(
        schema.parse(
          JSON.parse(
            await readFile(join(this.directory, "operators.json"), "utf8"),
          ),
        ),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error(
          "操作員名單無法讀取，請在主機確認設定檔。服務拒絕啟動。",
        );
    }
  }
  role(id?: string): "owner" | "operator" | null {
    return id === ownerId
      ? "owner"
      : id && this.users.has(id)
        ? "operator"
        : null;
  }
  list() {
    return [...this.users];
  }
  save(input: unknown) {
    const values = [...new Set(schema.parse(input))].filter(
      (id) => id !== ownerId,
    );
    const work = this.queue.then(async () => {
      await mkdir(this.directory, { recursive: true });
      const target = join(this.directory, "operators.json");
      const temporary = join(this.directory, `operators.${randomUUID()}.tmp`);
      await writeFile(temporary, JSON.stringify(values), {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporary, target);
      this.users = new Set(values);
    });
    this.queue = work.catch(() => {});
    return work;
  }
}
