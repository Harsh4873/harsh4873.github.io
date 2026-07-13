import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { answerFromPaper, summarizePaper } from "../lib/groq.js";
import { HttpError } from "../lib/http.js";

const originalFetch = globalThis.fetch;

function validAnalysis() {
  return {
    title: "A grounded paper",
    authors: ["Researcher One"],
    paperType: "Research article",
    publication: { venue: null, year: null, doi: null, url: "https://example.com/paper" },
    overview: "Overview",
    researchQuestion: "Question",
    abstractSummary: "Abstract",
    methods: [],
    keyFindings: [],
    sectionSummaries: [],
    figures: [],
    tables: [],
    equations: [],
    limitations: [],
    glossary: [],
    references: [],
    sourceLedger: [],
    synthesis: { contribution: "Contribution", novelty: "Novelty", implications: [], openQuestions: [] },
    warnings: [],
  };
}

function chatCompletion(content: string, extra: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      id: "chatcmpl_abcdef123",
      model: "openai/gpt-oss-120b",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      ...extra,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

const samplePages = [{ page: 1, text: "The study measured throughput on page one." }];

beforeEach(() => {
  process.env.GROQ_API_KEY = "server-test-key-never-logged";
  process.env.GROQ_MODEL = "openai/gpt-oss-120b";
  delete process.env.GROQ_BASE_URL;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe("Groq boundary", () => {
  it("sends page-delimited text with a strict schema and never puts the key in the body", async () => {
    const fetchMock = vi.fn(async () => chatCompletion(JSON.stringify(validAnalysis())));
    globalThis.fetch = fetchMock;

    await summarizePaper({ pages: samplePages, metadata: { title: "Paper" }, truncated: false }, "request-2");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://api.groq.com/openai/v1/chat/completions");

    const body = JSON.parse(String(init?.body)) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
      response_format: { type: string; json_schema: { strict: boolean; schema: { additionalProperties: boolean } } };
      reasoning_effort: string;
    };
    expect(body.model).toBe("openai/gpt-oss-120b");
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.additionalProperties).toBe(false);
    expect(body.messages[0]?.role).toBe("system");
    expect(body.messages[1]?.content).toContain("=== PDF page 1 ===");
    expect(body.messages[1]?.content).toContain("The study measured throughput on page one.");

    expect(String(init?.body)).not.toContain(process.env.GROQ_API_KEY ?? "missing");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${process.env.GROQ_API_KEY}`);
  });

  it("returns a structured contextual answer", async () => {
    const answer = { answer: "Throughput improved.", grounded: true, evidence: [], uncertainty: "Low.", followUps: [] };
    globalThis.fetch = vi.fn(async () => chatCompletion(JSON.stringify(answer)));

    await expect(
      answerFromPaper(
        { pages: samplePages, question: "What improved?", context: {}, recentMessages: [], truncated: false },
        "request-ask",
      ),
    ).resolves.toMatchObject({ value: answer, model: "openai/gpt-oss-120b" });
  });

  it("maps a busy upstream to the stable rate-limit error", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: { message: "sensitive upstream detail", type: "rate_limit_exceeded", code: "rate_limit_exceeded" } }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      summarizePaper({ pages: samplePages, metadata: {}, truncated: false }, "request-3"),
    ).rejects.toMatchObject<Partial<HttpError>>({ status: 503, code: "ai_busy" });
  });

  it("maps an auth failure to a non-reflective configuration error", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: { message: "invalid api key", type: "invalid_request_error", code: "invalid_api_key" } }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      summarizePaper({ pages: samplePages, metadata: {}, truncated: false }, "request-4"),
    ).rejects.toMatchObject<Partial<HttpError>>({ status: 503, code: "ai_configuration_error" });
  });

  it("rejects model output that is valid JSON but violates the app contract", async () => {
    globalThis.fetch = vi.fn(async () => chatCompletion("{}"));

    await expect(
      summarizePaper({ pages: samplePages, metadata: {}, truncated: false }, "request-invalid"),
    ).rejects.toMatchObject<Partial<HttpError>>({ status: 502, code: "invalid_ai_response" });
  });

  it("rejects a length-truncated completion instead of parsing partial JSON", async () => {
    globalThis.fetch = vi.fn(async () =>
      chatCompletion(JSON.stringify(validAnalysis()), {
        choices: [{ index: 0, message: { role: "assistant", content: "{\"title\":\"cut off" }, finish_reason: "length" }],
      }),
    );

    await expect(
      summarizePaper({ pages: samplePages, metadata: {}, truncated: false }, "request-length"),
    ).rejects.toMatchObject<Partial<HttpError>>({ status: 502, code: "invalid_ai_response" });
  });
});
