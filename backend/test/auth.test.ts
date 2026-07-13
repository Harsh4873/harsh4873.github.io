import { generateKeyPairSync, sign } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetCertificateCacheForTests, verifyFirebaseToken } from "../lib/auth.js";
import { HttpError } from "../lib/http.js";

const originalFetch = globalThis.fetch;
const now = 1_800_000_000;
const adminUid = "EWCVRJNa0UTVnP880ZOxhUxwvtZ2";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function token(overrides: Record<string, unknown> = {}): string {
  const header = encode({ alg: "RS256", typ: "JWT", kid: "test-key" });
  const payload = encode({
    aud: "pickledgerpro",
    iss: "https://securetoken.google.com/pickledgerpro",
    sub: adminUid,
    user_id: adminUid,
    email: "hdav4873@gmail.com",
    email_verified: true,
    iat: now - 100,
    exp: now + 3_000,
    auth_time: now - 200,
    firebase: { sign_in_provider: "google.com" },
    ...overrides,
  });
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

beforeEach(() => {
  process.env.NODE_ENV = "test";
  process.env.FIREBASE_PROJECT_ID = "pickledgerpro";
  process.env.ADMIN_EMAIL = "hdav4873@gmail.com";
  process.env.ADMIN_UID = adminUid;
  __resetCertificateCacheForTests();
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ "test-key": publicPem }), {
      status: 200,
      headers: { "Cache-Control": "public, max-age=3600" },
    }),
  );
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe("Firebase owner authentication", () => {
  it("accepts only the configured verified Google owner identity", async () => {
    await expect(verifyFirebaseToken(token(), now)).resolves.toEqual({
      uid: adminUid,
      email: "hdav4873@gmail.com",
      issuedAt: now - 100,
      expiresAt: now + 3_000,
    });
  });

  it.each([
    { email: "attacker@example.com" },
    { sub: "differentUid", user_id: "differentUid" },
    { email_verified: false },
    { firebase: { sign_in_provider: "password" } },
    { aud: "another-project" },
    { iss: "https://securetoken.google.com/another-project" },
    { exp: now - 1000 },
  ])("rejects claims outside the owner boundary", async (overrides) => {
    await expect(verifyFirebaseToken(token(overrides), now)).rejects.toMatchObject<HttpError>({
      code: "admin_required",
      status: 403,
    });
  });

  it("rejects a token whose signed payload was modified", async () => {
    const valid = token();
    const [header, , signature] = valid.split(".");
    const changed = encode({
      aud: "pickledgerpro",
      iss: "https://securetoken.google.com/pickledgerpro",
      sub: adminUid,
      email: "hdav4873@gmail.com",
      email_verified: true,
      iat: now - 1,
      exp: now + 3000,
      firebase: { sign_in_provider: "google.com" },
    });
    await expect(verifyFirebaseToken(`${header}.${changed}.${signature}`, now)).rejects.toMatchObject<HttpError>({
      code: "invalid_token",
      status: 401,
    });
  });
});
