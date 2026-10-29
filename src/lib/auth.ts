export const COOKIE_NAME = "session";
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

async function getSigningKey(): Promise<CryptoKey> {
  const secret =
    process.env.APP_SECRET ||
    (process.env.APP_PASSWORD || "") + "__session_signing_key";
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function signSessionValue(value: string): Promise<string> {
  const key = await getSigningKey();
  const encoder = new TextEncoder();
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(value)
  );
  const signature = btoa(
    String.fromCharCode(...new Uint8Array(signatureBuffer))
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${value}.${signature}`;
}

export async function verifySessionCookie(cookie: string): Promise<boolean> {
  const lastDot = cookie.lastIndexOf(".");
  if (lastDot === -1) return false;

  const value = cookie.slice(0, lastDot);
  const signature = cookie.slice(lastDot + 1);

  // Decode base64url signature
  const base64 = signature.replace(/-/g, "+").replace(/_/g, "/");
  const binaryString = atob(base64);
  const signatureBytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    signatureBytes[i] = binaryString.charCodeAt(i);
  }

  const key = await getSigningKey();
  const encoder = new TextEncoder();
  return crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes,
    encoder.encode(value)
  );
}

export function verifyPassword(input: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  // Constant-time comparison (this module also runs in middleware, so no node:crypto).
  const a = new TextEncoder().encode(input);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  return diff === 0;
}
