import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ControlError } from "./errors.js";
import type {
  LaneId,
  PublicSettings,
  SettingsInput,
  SourceId,
} from "../shared/types.js";

const snowflake = z
  .string()
  .regex(/^\d{17,20}$/, "請輸入有效的 Discord ID（17–20 位數字）");
export const settingsSchema = z.object({
  guildId: snowflake,
  channels: z.object({ A: snowflake, B: snowflake }),
  tokens: z.object({
    A: z.string().max(256).trim(),
    B: z.string().max(256).trim(),
  }),
});
const savedSchema = settingsSchema.extend({
  selected: z.object({ A: z.enum(["A", "B"]), B: z.enum(["A", "B"]) }),
});
export type SavedSettings = SettingsInput & {
  selected: Record<LaneId, SourceId>;
};
export const emptySettings = (): SavedSettings => ({
  guildId: "",
  channels: { A: "", B: "" },
  tokens: { A: "", B: "" },
  selected: { A: "A", B: "B" },
});
export function publicSettings(settings: SavedSettings): PublicSettings {
  return {
    guildId: settings.guildId,
    channels: { ...settings.channels },
    selected: { ...settings.selected },
    tokensSaved: {
      A: Boolean(settings.tokens.A),
      B: Boolean(settings.tokens.B),
    },
  };
}

// Secrets travel over stdin, never through command-line arguments or PowerShell logs.
export function dpapi(value: string, decrypt = false): Promise<string> {
  if (process.platform !== "win32")
    return Promise.reject(
      new ControlError(
        "憑證保存只支援 Windows 使用者加密；請在 Windows 執行。",
      ),
    );
  const script = `Add-Type -AssemblyName System.Security; $inputData = [Console]::In.ReadToEnd(); try { $bytes = [Convert]::FromBase64String($inputData); $result = [System.Security.Cryptography.ProtectedData]::${decrypt ? "Unprotect" : "Protect"}($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result)) } catch { exit 1 }`;
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new ControlError("Windows 憑證加密逾時，請重試。"));
    }, 15_000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.resume();
    child.on("error", () => {
      clearTimeout(timer);
      reject(new ControlError("無法啟動 Windows 憑證加密。"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0)
        reject(
          new ControlError(
            "無法解密本機憑證；移轉電腦或 Windows 使用者後請重新輸入兩個 Token。",
          ),
        );
      else resolve(output.trim());
    });
    child.stdin.end(value);
  });
}
export interface SettingsStore {
  load(): Promise<SavedSettings>;
  save(settings: SavedSettings): Promise<void>;
}
export class WindowsSettingsStore implements SettingsStore {
  private pending: Promise<void> = Promise.resolve();
  constructor(
    readonly directory = join(process.env.LOCALAPPDATA ?? ".", "PulseMic"),
  ) {}
  async load() {
    let encrypted: string;
    try {
      encrypted = await readFile(
        join(this.directory, "credentials.secrets"),
        "utf8",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return emptySettings();
      throw new ControlError("無法讀取本機設定，請檢查資料夾權限。");
    }
    const clear = Buffer.from(await dpapi(encrypted, true), "base64").toString(
      "utf8",
    );
    return savedSchema.parse(JSON.parse(clear));
  }
  save(settings: SavedSettings) {
    const clear = Buffer.from(JSON.stringify(settings)).toString("base64");
    const operation = this.pending.then(async () => {
      const encrypted = await dpapi(clear);
      await mkdir(this.directory, { recursive: true });
      const temporary = join(this.directory, `${randomUUID()}.secrets`);
      await writeFile(temporary, encrypted, { mode: 0o600 });
      await rename(temporary, join(this.directory, "credentials.secrets"));
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
}
