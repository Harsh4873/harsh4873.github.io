import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_MAX_PDF_BYTES, DEFAULT_MAX_UPLOAD_PART_BYTES, getMaxUploadPartBytes } from "../lib/config.js";
import { HttpError } from "../lib/http.js";
import {
  parseAsk,
  parseFileId,
  parseSummarize,
  parseUploadComplete,
  parseUploadStart,
} from "../lib/validation.js";

afterEach(() => {
  delete process.env.MAX_PDF_BYTES;
  delete process.env.MAX_UPLOAD_PART_BYTES;
});

describe("request validation", () => {
  it("accepts a PDF at the 50 MiB boundary", () => {
    expect(
      parseUploadStart({
        bytes: DEFAULT_MAX_PDF_BYTES,
        filename: "Attention Is All You Need.pdf",
        mimeType: "application/pdf",
      }),
    ).toEqual({
      bytes: DEFAULT_MAX_PDF_BYTES,
      filename: "Attention Is All You Need.pdf",
      mimeType: "application/pdf",
    });
  });

  it("normalizes path-safe local-model filenames to a PDF upload name", () => {
    expect(
      parseUploadStart({ bytes: 100, filename: "Research notes", mimeType: "application/pdf" }),
    ).toEqual({ bytes: 100, filename: "Research notes.pdf", mimeType: "application/pdf" });

    const maximumLengthName = "x".repeat(1_000);
    const parsed = parseUploadStart({ bytes: 100, filename: maximumLengthName, mimeType: "application/pdf" });
    expect(parsed.filename).toHaveLength(1_000);
    expect(parsed.filename.endsWith(".pdf")).toBe(true);
  });

  it.each([
    { bytes: DEFAULT_MAX_PDF_BYTES + 1, filename: "paper.pdf", mimeType: "application/pdf" },
    { bytes: 100, filename: "../paper.pdf", mimeType: "application/pdf" },
    { bytes: 100, filename: "x".repeat(1_001), mimeType: "application/pdf" },
    { bytes: 100, filename: "paper.pdf", mimeType: "text/plain" },
  ])("rejects an invalid PDF descriptor", (value) => {
    expect(() => parseUploadStart(value)).toThrowError(HttpError);
  });

  it("caps upload parts at 2.75 MiB even when an environment value is larger", () => {
    process.env.MAX_UPLOAD_PART_BYTES = String(DEFAULT_MAX_UPLOAD_PART_BYTES + 1);
    expect(() => getMaxUploadPartBytes()).toThrow(/outside its allowed range/);
  });

  it("validates upload completion order and uniqueness", () => {
    expect(
      parseUploadComplete({ uploadId: "upload_abcdef123", partIds: ["part_abcdef123", "part_abcdef456"] }),
    ).toEqual({ uploadId: "upload_abcdef123", partIds: ["part_abcdef123", "part_abcdef456"] });
    expect(() =>
      parseUploadComplete({ uploadId: "upload_abcdef123", partIds: ["part_abcdef123", "part_abcdef123"] }),
    ).toThrowError(HttpError);
  });

  it("bounds summarize context while preserving the canonical file id", () => {
    expect(
      parseSummarize({
        fileId: "file-abcdef123",
        metadata: { title: "Paper" },
        localOutline: ["Abstract", "Methods"],
      }),
    ).toEqual({
      fileId: "file-abcdef123",
      metadata: { title: "Paper" },
      localOutline: ["Abstract", "Methods"],
    });
    expect(() =>
      parseSummarize({ fileId: "file-abcdef123", metadata: { text: "x".repeat(20_000) } }),
    ).toThrowError(HttpError);
  });

  it("normalizes bounded contextual questions", () => {
    expect(
      parseAsk({
        fileId: "file-abcdef123",
        paperId: "paper:01",
        question: "  What does Figure 2 establish?  ",
        context: { currentTab: "visuals", currentPage: 4, selectedText: "caption" },
        recentMessages: [{ role: "assistant", content: "Earlier answer" }],
      }),
    ).toEqual({
      fileId: "file-abcdef123",
      paperId: "paper:01",
      question: "What does Figure 2 establish?",
      context: { currentTab: "visuals", currentPage: 4, selectedText: "caption" },
      recentMessages: [{ role: "assistant", content: "Earlier answer" }],
    });
  });

  it("rejects malformed OpenAI identifiers", () => {
    expect(() => parseFileId("https://example.com/file-id")).toThrowError(HttpError);
    expect(() => parseFileId("file-x")).toThrowError(HttpError);
  });
});
