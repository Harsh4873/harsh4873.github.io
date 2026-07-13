import { createVerify } from "node:crypto";
import { getAuthConfig } from "./config.js";
import { headerValue, HttpError } from "./http.js";
import type { ApiRequest } from "./vercel.js";

const FIREBASE_CERT_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const MAX_JWT_BYTES = 16 * 1024;
const CLOCK_SKEW_SECONDS = 60;

interface JwtHeader {
  alg?: unknown;
  kid?: unknown;
  typ?: unknown;
}

interface FirebasePayload {
  aud?: unknown;
  iss?: unknown;
  sub?: unknown;
  user_id?: unknown;
  email?: unknown;
  email_verified?: unknown;
  exp?: unknown;
  iat?: unknown;
  auth_time?: unknown;
  firebase?: unknown;
}

interface FirebaseClaims {
  uid: string;
  email: string;
  issuedAt: number;
  expiresAt: number;
}

interface CertificateCache {
  certificates: Readonly<Record<string, string>>;
  expiresAt: number;
}

let certificateCache: CertificateCache | undefined;

function decodeSegment<T>(segment: string): T {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) {
    throw new HttpError(401, "invalid_token", "The sign-in token is invalid.");
  }
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as T;
  } catch {
    throw new HttpError(401, "invalid_token", "The sign-in token is invalid.");
  }
}

function cacheLifetime(response: Response): number {
  const cacheControl = response.headers.get("cache-control") || "";
  const match = /(?:^|,)\s*max-age=(\d+)/i.exec(cacheControl);
  const seconds = match ? Number(match[1]) : 3600;
  const safeSeconds = Number.isFinite(seconds) ? Math.min(Math.max(seconds, 300), 86_400) : 3600;
  return safeSeconds * 1000;
}

async function getCertificates(): Promise<Readonly<Record<string, string>>> {
  const now = Date.now();
  if (certificateCache && certificateCache.expiresAt > now) return certificateCache.certificates;

  let response: Response;
  try {
    response = await fetch(FIREBASE_CERT_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new HttpError(503, "auth_unavailable", "Sign-in verification is temporarily unavailable.");
  }

  if (!response.ok) {
    throw new HttpError(503, "auth_unavailable", "Sign-in verification is temporarily unavailable.");
  }

  const raw: unknown = await response.json().catch(() => undefined);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpError(503, "auth_unavailable", "Sign-in verification is temporarily unavailable.");
  }

  const certificates: Record<string, string> = {};
  for (const [kid, certificate] of Object.entries(raw)) {
    if (/^[A-Za-z0-9_-]{1,160}$/.test(kid) && typeof certificate === "string" && certificate.length < 10_000) {
      certificates[kid] = certificate;
    }
  }
  if (Object.keys(certificates).length === 0) {
    throw new HttpError(503, "auth_unavailable", "Sign-in verification is temporarily unavailable.");
  }

  certificateCache = {
    certificates: Object.freeze(certificates),
    expiresAt: now + cacheLifetime(response) - 30_000,
  };
  return certificateCache.certificates;
}

function validateFirebaseClaims(payload: FirebasePayload, nowSeconds: number): FirebaseClaims {
  const { projectId, adminEmail, adminUid } = getAuthConfig();
  const expectedIssuer = `https://securetoken.google.com/${projectId}`;
  const firebase = payload.firebase;
  const provider =
    firebase && typeof firebase === "object" && !Array.isArray(firebase)
      ? (firebase as Record<string, unknown>).sign_in_provider
      : undefined;

  if (
    payload.aud !== projectId ||
    payload.iss !== expectedIssuer ||
    payload.sub !== adminUid ||
    (payload.user_id !== undefined && payload.user_id !== adminUid) ||
    typeof payload.exp !== "number" ||
    typeof payload.iat !== "number" ||
    !Number.isFinite(payload.exp) ||
    !Number.isFinite(payload.iat) ||
    payload.exp <= nowSeconds - CLOCK_SKEW_SECONDS ||
    payload.iat > nowSeconds + CLOCK_SKEW_SECONDS ||
    (payload.auth_time !== undefined &&
      (typeof payload.auth_time !== "number" || payload.auth_time > nowSeconds + CLOCK_SKEW_SECONDS)) ||
    typeof payload.email !== "string" ||
    payload.email.toLowerCase() !== adminEmail ||
    payload.email_verified !== true ||
    provider !== "google.com"
  ) {
    throw new HttpError(403, "admin_required", "This API is limited to the Sift owner account.");
  }

  return {
    uid: adminUid,
    email: adminEmail,
    issuedAt: payload.iat,
    expiresAt: payload.exp,
  };
}

export async function verifyFirebaseToken(
  token: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<FirebaseClaims> {
  if (Buffer.byteLength(token) > MAX_JWT_BYTES) {
    throw new HttpError(401, "invalid_token", "The sign-in token is invalid.");
  }
  const segments = token.split(".");
  if (segments.length !== 3) {
    throw new HttpError(401, "invalid_token", "The sign-in token is invalid.");
  }
  const [encodedHeader, encodedPayload, encodedSignature] = segments;
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new HttpError(401, "invalid_token", "The sign-in token is invalid.");
  }

  const header = decodeSegment<JwtHeader>(encodedHeader);
  if (
    header.alg !== "RS256" ||
    typeof header.kid !== "string" ||
    !/^[A-Za-z0-9_-]{1,160}$/.test(header.kid) ||
    (header.typ !== undefined && header.typ !== "JWT")
  ) {
    throw new HttpError(401, "invalid_token", "The sign-in token is invalid.");
  }

  const certificates = await getCertificates();
  const certificate = certificates[header.kid];
  if (!certificate) {
    throw new HttpError(401, "invalid_token", "The sign-in token is invalid.");
  }

  let signature: Buffer;
  try {
    signature = Buffer.from(encodedSignature, "base64url");
  } catch {
    throw new HttpError(401, "invalid_token", "The sign-in token is invalid.");
  }

  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${encodedHeader}.${encodedPayload}`, "ascii");
  verifier.end();
  let valid = false;
  try {
    valid = verifier.verify(certificate, signature);
  } catch {
    valid = false;
  }
  if (!valid) throw new HttpError(401, "invalid_token", "The sign-in token is invalid.");

  const payload = decodeSegment<FirebasePayload>(encodedPayload);
  return validateFirebaseClaims(payload, nowSeconds);
}

export async function authenticate(req: ApiRequest): Promise<FirebaseClaims> {
  const authorization = headerValue(req, "authorization");
  const match = authorization ? /^Bearer\s+([^\s]+)$/i.exec(authorization) : null;
  if (!match?.[1]) {
    throw new HttpError(401, "authentication_required", "Sign in with the Sift owner account.");
  }
  return verifyFirebaseToken(match[1]);
}

export function __resetCertificateCacheForTests(): void {
  if (process.env.NODE_ENV !== "test") return;
  certificateCache = undefined;
}
