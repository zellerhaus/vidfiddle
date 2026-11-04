import assert from "node:assert/strict";
import { test } from "node:test";
import { isHttpsRequest, verifyPassword } from "../src/lib/auth";
import { POST as login } from "../src/app/api/auth/login/route";
import { POST as logout } from "../src/app/api/auth/logout/route";

test("verifyPassword accepts only the exact password", () => {
  process.env.APP_PASSWORD = "correct horse";
  assert.ok(verifyPassword("correct horse"));
  assert.ok(!verifyPassword("correct hors"));
  assert.ok(!verifyPassword("correct horse!"));
  assert.ok(!verifyPassword(""));
});

test("verifyPassword rejects everything when no password is configured", () => {
  delete process.env.APP_PASSWORD;
  assert.ok(!verifyPassword(""));
  assert.ok(!verifyPassword("anything"));
});

test("isHttpsRequest follows the URL, or the proxy's X-Forwarded-Proto when set", () => {
  const request = (url: string, proto?: string) =>
    new Request(url, { headers: proto ? { "x-forwarded-proto": proto } : {} });

  assert.ok(!isHttpsRequest(request("http://192.168.1.20:3000/api/auth/login")));
  assert.ok(isHttpsRequest(request("https://vidfiddle.example.com/api/auth/login")));
  assert.ok(isHttpsRequest(request("http://app:3000/api/auth/login", "https")));
  assert.ok(isHttpsRequest(request("http://app:3000/api/auth/login", "https, http")));
  assert.ok(!isHttpsRequest(request("http://app:3000/api/auth/login", "http")));
});

function loginRequest(url: string, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ password: "correct horse" }),
  }) as Parameters<typeof login>[0];
}

// NODE_ENV is production in the Docker image, which used to make the cookie Secure everywhere.
test("login sets a Secure cookie only over HTTPS, even in production", async () => {
  const env = process.env as Record<string, string | undefined>;
  const nodeEnv = env.NODE_ENV;
  env.NODE_ENV = "production";
  process.env.APP_PASSWORD = "correct horse";
  try {
    const overLan = await login(loginRequest("http://192.168.1.20:3000/api/auth/login"));
    assert.equal(overLan.status, 200);
    const lanCookie = overLan.headers.get("set-cookie") ?? "";
    assert.match(lanCookie, /^session=/);
    assert.doesNotMatch(lanCookie, /secure/i);

    const behindProxy = await login(
      loginRequest("http://app:3000/api/auth/login", { "x-forwarded-proto": "https" })
    );
    assert.match(behindProxy.headers.get("set-cookie") ?? "", /secure/i);

    const loggedOut = await logout(
      new Request("http://192.168.1.20:3000/api/auth/logout", { method: "POST" }) as Parameters<
        typeof logout
      >[0]
    );
    assert.doesNotMatch(loggedOut.headers.get("set-cookie") ?? "", /secure/i);
  } finally {
    env.NODE_ENV = nodeEnv;
    delete process.env.APP_PASSWORD;
  }
});
