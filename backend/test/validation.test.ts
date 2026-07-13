import { describe, expect, it } from "vitest";
import { HttpError } from "../lib/http.js";
import { parseAsk, parsePaperPages, parseSummarize } from "../lib/validation.js";

describe("request validation", () => {
  it("accepts summarize input with page-delimited paper text", () => {
    expect(
      parseSummarize({
        pages: [{ page: 1, text: "Intro text" }, { page: 2, text: "Methods text" }],
        metadata: { title: "Paper" },
        localOutline: ["Abstract", "Methods"],
      }),
    ).toEqual({
      pages: [{ page: 1, text: "Intro text" }, { page: 2, text: "Methods text" }],
      metadata: { title: "Paper" },
      truncated: false,
      localOutline: ["Abstract", "Methods"],
    });
  });

  it("carries the client truncation flag through to the model request", () => {
    const parsed = parseSummarize({ pages: [{ page: 1, text: "Body" }], metadata: {}, truncated: true });
    expect(parsed.truncated).toBe(true);
  });

  it("rejects oversized summarize metadata", () => {
    expect(() =>
      parseSummarize({ pages: [{ page: 1, text: "Body" }], metadata: { text: "x".repeat(20_000) } }),
    ).toThrowError(HttpError);
  });

  it("strips forbidden control characters from page text while keeping order", () => {
    const pages = parsePaperPages([{ page: 1, text: `a${String.fromCharCode(0)}b` }, { page: 2, text: "second" }]);
    expect(pages).toEqual([{ page: 1, text: "a b" }, { page: 2, text: "second" }]);
  });

  it.each([
    ["missing pages", { metadata: {} }],
    ["an empty page list", { pages: [], metadata: {} }],
    ["an invalid page number", { pages: [{ page: 0, text: "Body" }], metadata: {} }],
  ])("rejects summarize input with %s", (_description, value) => {
    expect(() => parseSummarize(value)).toThrowError(HttpError);
  });

  it("flags a PDF with no selectable text so the client can explain image-only papers", () => {
    expect(() => parsePaperPages([{ page: 1, text: "   " }])).toThrowError(
      expect.objectContaining({ status: 422, code: "no_extractable_text" }),
    );
  });

  it("normalizes a bounded contextual question with paper pages", () => {
    expect(
      parseAsk({
        pages: [{ page: 4, text: "Figure 2 shows the throughput curve." }],
        paperId: "paper:01",
        question: "  What does Figure 2 establish?  ",
        context: { currentTab: "visuals", currentPage: 4, selectedText: "caption" },
        recentMessages: [{ role: "assistant", content: "Earlier answer" }],
      }),
    ).toEqual({
      pages: [{ page: 4, text: "Figure 2 shows the throughput curve." }],
      paperId: "paper:01",
      question: "What does Figure 2 establish?",
      context: { currentTab: "visuals", currentPage: 4, selectedText: "caption" },
      recentMessages: [{ role: "assistant", content: "Earlier answer" }],
      truncated: false,
    });
  });

  it("requires paper pages before answering a question", () => {
    expect(() =>
      parseAsk({ paperId: "paper:01", question: "What is supported?", context: {}, recentMessages: [] }),
    ).toThrowError(HttpError);
  });
});
