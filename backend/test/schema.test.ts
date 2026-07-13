import { describe, expect, it } from "vitest";
import {
  contextualAnswerJsonSchema,
  paperAnalysisJsonSchema,
  parsePaperAnalysisResult,
  StructuredOutputValidationError,
} from "../lib/schemas.js";

function validAnalysis(): Record<string, unknown> {
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

describe("Structured Output contracts", () => {
  it("keeps the canonical Sift analysis keys exact and strict", () => {
    expect(paperAnalysisJsonSchema.additionalProperties).toBe(false);
    expect(paperAnalysisJsonSchema.required).toEqual([
      "title",
      "authors",
      "paperType",
      "publication",
      "overview",
      "researchQuestion",
      "abstractSummary",
      "methods",
      "keyFindings",
      "sectionSummaries",
      "figures",
      "tables",
      "equations",
      "limitations",
      "glossary",
      "references",
      "sourceLedger",
      "synthesis",
      "warnings",
    ]);
    expect(paperAnalysisJsonSchema.properties.publication.required).toEqual(["venue", "year", "doi", "url"]);
    expect(paperAnalysisJsonSchema.properties.sourceLedger.items.properties.confidence.enum).toEqual([
      "high",
      "medium",
      "low",
    ]);
    expect(paperAnalysisJsonSchema.properties.publication.properties.url.pattern).toMatch(/https/);
    expect(paperAnalysisJsonSchema.properties.sourceLedger.items.properties.id.pattern).toBe(
      "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
    );
    expect(paperAnalysisJsonSchema.properties.title.pattern).toBe("\\S");
    expect(paperAnalysisJsonSchema.properties.title).not.toHaveProperty("maxLength");
    expect(paperAnalysisJsonSchema.properties.sourceLedger.maxItems).toBe(1_000);
  });

  it("accepts a complete frontend-compatible paper analysis", () => {
    const analysis = validAnalysis();
    expect(parsePaperAnalysisResult(analysis)).toBe(analysis);
  });

  it.each([
    ["an HTTP publication URL", (analysis: Record<string, unknown>) => {
      analysis.publication = { venue: null, year: null, doi: null, url: "http://example.com/paper" };
    }],
    ["an invalid ledger id", (analysis: Record<string, unknown>) => {
      analysis.sourceLedger = [{
        id: "claim with spaces",
        type: "claim",
        title: "Claim",
        claim: "Finding",
        page: 1,
        quote: "Quote",
        paraphrase: "Paraphrase",
        context: "Context",
        confidence: "high",
      }];
    }],
    ["a whitespace-only title", (analysis: Record<string, unknown>) => {
      analysis.title = "   ";
    }],
  ])("rejects model output with %s", (_description, mutate) => {
    const analysis = validAnalysis();
    mutate(analysis);
    expect(() => parsePaperAnalysisResult(analysis)).toThrowError(StructuredOutputValidationError);
  });

  it("requires page-grounded contextual answers", () => {
    expect(contextualAnswerJsonSchema.additionalProperties).toBe(false);
    expect(contextualAnswerJsonSchema.required).toEqual([
      "answer",
      "grounded",
      "evidence",
      "uncertainty",
      "followUps",
    ]);
    expect(contextualAnswerJsonSchema.properties.evidence.items.required).toContain("page");
  });
});
