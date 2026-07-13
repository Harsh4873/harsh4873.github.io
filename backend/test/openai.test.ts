import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../lib/http.js";
import { deleteOpenAIFile, startPdfUpload, summarizePdf } from "../lib/openai.js";

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

beforeEach(() => {
  process.env.OPENAI_API_KEY = "server-test-key-never-logged";
  process.env.OPENAI_MODEL = "gpt-5.6-terra";
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe("OpenAI boundary", () => {
  it("creates vision uploads without putting the API key in a payload", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: "upload_abcdef123",
          bytes: 1200,
          filename: "paper.pdf",
          expires_at: 1_900_000_000,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    globalThis.fetch = fetchMock;

    await expect(
      startPdfUpload({ bytes: 1200, filename: "paper.pdf", mimeType: "application/pdf" }, "request-1"),
    ).resolves.toMatchObject({ id: "upload_abcdef123", bytes: 1200 });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toEqual({
      purpose: "vision",
      bytes: 1200,
      filename: "paper.pdf",
      mime_type: "application/pdf",
    });
    expect(String(init?.body)).not.toContain(process.env.OPENAI_API_KEY ?? "missing");
  });

  it("uses non-stored, high-detail PDF input with the canonical strict schema", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: "resp_abcdef123",
          model: "gpt-5.6-terra",
          output_text: JSON.stringify(validAnalysis()),
          usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    globalThis.fetch = fetchMock;

    await summarizePdf({ fileId: "file-abcdef123", metadata: { title: "Paper" } }, "request-2");
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body)) as {
      store: boolean;
      input: Array<{ content: Array<Record<string, unknown>> }>;
      text: { format: { strict: boolean; schema: { additionalProperties: boolean } } };
    };
    expect(body.store).toBe(false);
    expect(body.input[1]?.content[0]).toMatchObject({
      type: "input_file",
      file_id: "file-abcdef123",
      detail: "high",
    });
    expect(body.text.format.strict).toBe(true);
    expect(body.text.format.schema.additionalProperties).toBe(false);
  });

  it("maps insufficient quota to the stable safe integration error", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: { message: "sensitive upstream detail", type: "insufficient_quota", code: "insufficient_quota" } }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      startPdfUpload({ bytes: 1200, filename: "paper.pdf", mimeType: "application/pdf" }, "request-3"),
    ).rejects.toMatchObject<HttpError>({
      status: 503,
      code: "openai_quota_required",
      message: "AI analysis is unavailable until API billing is enabled.",
    });
  });

  it("maps a missing response file to a recoverable stable error", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: { message: "not found", type: "invalid_request_error", code: "file_not_found" } }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      summarizePdf({ fileId: "file-abcdef123", metadata: { title: "Paper" } }, "request-4"),
    ).rejects.toMatchObject<HttpError>({
      status: 409,
      code: "ai_file_unavailable",
    });
  });

  it("rejects model output that is structurally valid JSON but violates the app contract", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ id: "resp_abcdef123", model: "gpt-5.6-terra", output_text: "{}" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(
      summarizePdf({ fileId: "file-abcdef123", metadata: { title: "Paper" } }, "request-invalid"),
    ).rejects.toMatchObject<HttpError>({
      status: 502,
      code: "invalid_ai_response",
    });
  });

  it("treats an already-absent remote file as an idempotent deletion", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: { message: "not found", type: "invalid_request_error", code: "file_not_found" } }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(deleteOpenAIFile("file-abcdef123", "request-5")).resolves.toEqual({
      id: "file-abcdef123",
      deleted: true,
    });
  });
});
