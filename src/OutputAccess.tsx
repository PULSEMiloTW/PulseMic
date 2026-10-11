import type { OutputKind } from "../shared/types";
export function OutputAccess({
  kind,
}: {
  kind: OutputKind;
  connected?: boolean;
  request?: (path: string, body: unknown) => Promise<unknown>;
}) {
  return (
    <section
      className="output-access"
      aria-label={kind === "caster" ? "主播台輸出" : "選手輸出"}
    >
      <h2>{kind === "caster" ? "主播台輸出" : "選手輸出"}</h2>
      <a
        className="open-output"
        href={kind === "caster" ? "/caster-output" : "/output"}
        target="_blank"
        rel="noopener noreferrer"
      >
        {kind === "caster" ? "開啟主播台輸出 ↗" : "開啟選手雙路輸出 ↗"}
      </a>
    </section>
  );
}
