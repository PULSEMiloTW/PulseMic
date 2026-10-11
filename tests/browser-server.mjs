import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
// Test process seeds real in-memory sessions; production has no test login endpoint.
const nativeFetch = globalThis.fetch;
process.env.PULSEMIC_DISCORD_CLIENT_ID = "123456789012345679";
process.env.PULSEMIC_DISCORD_CLIENT_SECRET =
  "fixture-secret-only-for-isolated-tests";
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === "https://discord.com/api/oauth2/token")
    return Response.json({ access_token: init.body.get("code") });
  if (url === "https://discord.com/api/v10/users/@me") {
    const code = init.headers.Authorization.slice(7);
    return Response.json({
      id:
        code === "owner"
          ? "1456945476933914626"
          : code === "operator"
            ? "123456789012345678"
            : "123456789012345680",
      username: "fixture",
      global_name: "Discord 測試名稱",
      avatar: "fixture_avatar",
    });
  }
  return nativeFetch(input, init);
};
const modulePath =
  process.env.PULSEMIC_TEST_PREVIEW === "1"
    ? ".local/preview/dist/server/server/index.js"
    : "dist/server/server/index.js";
const { access, permissions } = await import(
  pathToFileURL(resolve(modulePath)).href
);
const operatorId = "123456789012345678";
await permissions.save([operatorId]);
await mkdir(".local/browser-test", { recursive: true });
for (const [role, id] of [
  ["owner", "1456945476933914626"],
  ["operator", operatorId],
]) {
  const token = access.controller({
    id,
    name: role === "owner" ? "測試擁有者" : "測試操作員",
    avatar: "https://cdn.discordapp.com/embed/avatars/0.png",
  });
  await writeFile(
    `.local/browser-test/${role}.json`,
    JSON.stringify({
      cookies: [
        {
          name: "__Host-pulsemic",
          value: token,
          domain: "localhost",
          path: "/",
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
          expires: Math.floor(Date.now() / 1000) + 28800,
        },
      ],
      origins: [],
    }),
  );
}
