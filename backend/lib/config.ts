export interface PublicConfig {
  allowedOrigin: string;
}

export interface AuthConfig {
  projectId: string;
  adminEmail: string;
  adminUid: string;
}

export interface OpenAIConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export const MIB = 1024 * 1024;
export const DEFAULT_MAX_PDF_BYTES = 50 * MIB;
export const DEFAULT_MAX_UPLOAD_PART_BYTES = Math.floor(2.75 * MIB);

function integerFromEnv(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} is outside its allowed range`);
  }
  return parsed;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function normalizeOrigin(value: string): string {
  const url = new URL(value);
  const localhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(localhost && url.protocol === "http:")) {
    throw new Error("ALLOWED_ORIGIN must be HTTPS (except local development)");
  }
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("ALLOWED_ORIGIN must contain only a scheme, host, and optional port");
  }
  return url.origin;
}

export function getPublicConfig(): PublicConfig {
  return {
    allowedOrigin: normalizeOrigin(process.env.ALLOWED_ORIGIN?.trim() || "https://harsh.bet"),
  };
}

export function getAuthConfig(): AuthConfig {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim() || "pickledgerpro";
  const adminEmail = (process.env.ADMIN_EMAIL?.trim() || "hdav4873@gmail.com").toLowerCase();
  const adminUid = requiredEnv("ADMIN_UID");

  if (!/^[a-z0-9-]{4,40}$/i.test(projectId)) throw new Error("Invalid FIREBASE_PROJECT_ID");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail)) throw new Error("Invalid ADMIN_EMAIL");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(adminUid)) throw new Error("Invalid ADMIN_UID");

  return { projectId, adminEmail, adminUid };
}

export function getOpenAIConfig(): OpenAIConfig {
  const apiKey = requiredEnv("OPENAI_API_KEY");
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-5.6-terra";
  if (!/^gpt-[A-Za-z0-9._-]{1,80}$/.test(model)) throw new Error("Invalid OPENAI_MODEL");

  return {
    apiKey,
    model,
    timeoutMs: integerFromEnv("OPENAI_TIMEOUT_MS", 285_000, 5_000, 290_000),
  };
}

export function getMaxPdfBytes(): number {
  return integerFromEnv("MAX_PDF_BYTES", DEFAULT_MAX_PDF_BYTES, MIB, DEFAULT_MAX_PDF_BYTES);
}

export function getMaxUploadPartBytes(): number {
  return integerFromEnv(
    "MAX_UPLOAD_PART_BYTES",
    DEFAULT_MAX_UPLOAD_PART_BYTES,
    64 * 1024,
    DEFAULT_MAX_UPLOAD_PART_BYTES,
  );
}
