import { timingSafeEqual } from "node:crypto";
export function validHost(host: string | undefined, port: number): boolean {
  return host === `localhost:${port}` || host === `127.0.0.1:${port}`;
}
export function validOrigin(
  origin: string | undefined,
  host: string | undefined,
  port: number,
): boolean {
  return validHost(host, port) && origin === `http://${host}`;
}
export function validSession(
  value: string | undefined,
  expected: string,
): boolean {
  if (!value) return false;
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
