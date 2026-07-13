export interface PublicConfig {
  allowedOrigin: string;
}

export interface AuthConfig {
  projectId: string;
  adminEmail: string;
  adminUid: string;
}

export interface GroqConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
}

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

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("GROQ_BASE_URL must be HTTPS");
  }
  if (url.search || url.hash || url.username || url.password) {
    throw new Error("GROQ_BASE_URL must contain only a scheme, host, optional port, and path");
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
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

export function getGroqConfig(): GroqConfig {
  const apiKey = requiredEnv("GROQ_API_KEY");
  const model = process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b";
  // Groq model ids include a vendor prefix (for example "openai/gpt-oss-120b"),
  // so the slash is intentionally part of the allowed character set.
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{1,120}$/.test(model)) throw new Error("Invalid GROQ_MODEL");
  const baseUrl = normalizeBaseUrl(process.env.GROQ_BASE_URL?.trim() || "https://api.groq.com/openai/v1");

  return {
    apiKey,
    model,
    baseUrl,
    timeoutMs: integerFromEnv("GROQ_TIMEOUT_MS", 285_000, 5_000, 290_000),
  };
}
