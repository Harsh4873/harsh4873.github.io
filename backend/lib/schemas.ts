// String length keywords are intentionally enforced by the runtime parser below,
// not sent to Structured Outputs, whose generally supported subset does not
// currently list minLength/maxLength.
const boundedString = (_maximum: number) => ({ type: "string" } as const);
const nonEmptyString = (_maximum: number) => ({
  type: "string",
  pattern: "\\S",
} as const);
const nullableString = (_maximum: number) => ({ type: ["string", "null"] } as const);
const nullableHttpsUrl = {
  type: ["string", "null"],
  pattern: "^https:\\/\\/[^\\s]+$",
} as const;
const page = { type: "integer", minimum: 1, maximum: 100_000 } as const;

const evidenceDetail = {
  type: "object",
  additionalProperties: false,
  properties: {
    quote: boundedString(10_000),
    paraphrase: boundedString(20_000),
    context: boundedString(20_000),
  },
  required: ["quote", "paraphrase", "context"],
} as const;

const sectionEvidence = {
  type: "object",
  additionalProperties: false,
  properties: {
    page,
    quote: boundedString(10_000),
    paraphrase: boundedString(20_000),
    context: boundedString(20_000),
  },
  required: ["page", "quote", "paraphrase", "context"],
} as const;

export const paperAnalysisJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: nonEmptyString(1_000),
    authors: { type: "array", maxItems: 100, items: nonEmptyString(500) },
    paperType: boundedString(500),
    publication: {
      type: "object",
      additionalProperties: false,
      properties: {
        venue: nullableString(1_000),
        year: { type: ["integer", "null"], minimum: 1000, maximum: 3000 },
        doi: nullableString(512),
        url: nullableHttpsUrl,
      },
      required: ["venue", "year", "doi", "url"],
    },
    overview: boundedString(50_000),
    researchQuestion: boundedString(50_000),
    abstractSummary: boundedString(50_000),
    methods: {
      type: "array",
      maxItems: 200,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: nonEmptyString(500),
          description: boundedString(20_000),
          page,
          evidence: evidenceDetail,
        },
        required: ["name", "description", "page", "evidence"],
      },
    },
    keyFindings: {
      type: "array",
      maxItems: 300,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          claim: nonEmptyString(20_000),
          importance: boundedString(20_000),
          certainty: boundedString(2_000),
          page,
          evidence: evidenceDetail,
        },
        required: ["claim", "importance", "certainty", "page", "evidence"],
      },
    },
    sectionSummaries: {
      type: "array",
      maxItems: 300,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          heading: nonEmptyString(500),
          summary: boundedString(30_000),
          startPage: page,
          endPage: page,
          keyPoints: { type: "array", maxItems: 100, items: boundedString(5_000) },
          evidence: { type: "array", maxItems: 100, items: sectionEvidence },
        },
        required: ["heading", "summary", "startPage", "endPage", "keyPoints", "evidence"],
      },
    },
    figures: {
      type: "array",
      maxItems: 300,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: nullableString(200),
          title: nullableString(1_000),
          page,
          description: boundedString(20_000),
          interpretation: boundedString(20_000),
          keyTakeaway: boundedString(20_000),
          evidence: evidenceDetail,
          limitations: { type: "array", maxItems: 100, items: boundedString(5_000) },
        },
        required: [
          "label",
          "title",
          "page",
          "description",
          "interpretation",
          "keyTakeaway",
          "evidence",
          "limitations",
        ],
      },
    },
    tables: {
      type: "array",
      maxItems: 300,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: nullableString(200),
          title: nullableString(1_000),
          page,
          description: boundedString(20_000),
          interpretation: boundedString(20_000),
          keyTakeaway: boundedString(20_000),
          evidence: evidenceDetail,
          limitations: { type: "array", maxItems: 100, items: boundedString(5_000) },
          columns: { type: "array", maxItems: 250, items: boundedString(1_000) },
        },
        required: [
          "label",
          "title",
          "page",
          "description",
          "interpretation",
          "keyTakeaway",
          "evidence",
          "limitations",
          "columns",
        ],
      },
    },
    equations: {
      type: "array",
      maxItems: 500,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: nullableString(200),
          page,
          latex: boundedString(20_000),
          plainLanguage: boundedString(20_000),
          role: boundedString(10_000),
          variables: {
            type: "array",
            maxItems: 250,
            items: {
              type: "object",
              additionalProperties: false,
              properties: { symbol: boundedString(500), meaning: boundedString(5_000) },
              required: ["symbol", "meaning"],
            },
          },
          evidence: evidenceDetail,
        },
        required: ["label", "page", "latex", "plainLanguage", "role", "variables", "evidence"],
      },
    },
    limitations: {
      type: "array",
      maxItems: 200,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          limitation: nonEmptyString(20_000),
          impact: boundedString(20_000),
          page,
          evidence: evidenceDetail,
        },
        required: ["limitation", "impact", "page", "evidence"],
      },
    },
    glossary: {
      type: "array",
      maxItems: 500,
      items: {
        type: "object",
        additionalProperties: false,
        properties: { term: nonEmptyString(500), definition: boundedString(10_000), page },
        required: ["term", "definition", "page"],
      },
    },
    references: {
      type: "array",
      maxItems: 1_000,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          citation: nonEmptyString(10_000),
          doi: nullableString(512),
          url: nullableHttpsUrl,
          page,
        },
        required: ["citation", "doi", "url", "page"],
      },
    },
    sourceLedger: {
      type: "array",
      maxItems: 1_000,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: {
            type: "string",
            pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
          },
          type: {
            type: "string",
            enum: ["claim", "method", "figure", "table", "equation", "limitation", "reference", "other"],
          },
          title: nonEmptyString(1_000),
          claim: boundedString(20_000),
          page,
          quote: boundedString(10_000),
          paraphrase: boundedString(20_000),
          context: boundedString(20_000),
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["id", "type", "title", "claim", "page", "quote", "paraphrase", "context", "confidence"],
      },
    },
    synthesis: {
      type: "object",
      additionalProperties: false,
      properties: {
        contribution: boundedString(50_000),
        novelty: boundedString(50_000),
        implications: { type: "array", maxItems: 200, items: boundedString(10_000) },
        openQuestions: { type: "array", maxItems: 200, items: boundedString(10_000) },
      },
      required: ["contribution", "novelty", "implications", "openQuestions"],
    },
    warnings: { type: "array", maxItems: 100, items: boundedString(5_000) },
  },
  required: [
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
  ],
} as const;

export const contextualAnswerJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string" },
    grounded: { type: "boolean" },
    evidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          page,
          label: { type: "string" },
          section: { type: "string" },
          quote: { type: "string" },
          explanation: { type: "string" },
        },
        required: ["page", "label", "section", "quote", "explanation"],
      },
    },
    uncertainty: { type: "string" },
    followUps: { type: "array", items: { type: "string" } },
  },
  required: ["answer", "grounded", "evidence", "uncertainty", "followUps"],
} as const;

interface RuntimeSchema {
  type?: string | readonly string[];
  enum?: readonly unknown[];
  properties?: Readonly<Record<string, RuntimeSchema>>;
  required?: readonly string[];
  additionalProperties?: boolean;
  items?: RuntimeSchema;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
}

const RUNTIME_STRING_MAXIMUMS = new Map<string, number>([
  ["analysis.title", 1_000],
  ["analysis.authors[]", 500],
  ["analysis.paperType", 500],
  ["analysis.publication.venue", 1_000],
  ["analysis.publication.doi", 512],
  ["analysis.publication.url", 2_048],
  ["analysis.overview", 50_000],
  ["analysis.researchQuestion", 50_000],
  ["analysis.abstractSummary", 50_000],
  ["analysis.methods[].name", 500],
  ["analysis.methods[].description", 20_000],
  ["analysis.methods[].evidence.quote", 10_000],
  ["analysis.methods[].evidence.paraphrase", 20_000],
  ["analysis.methods[].evidence.context", 20_000],
  ["analysis.keyFindings[].claim", 20_000],
  ["analysis.keyFindings[].importance", 20_000],
  ["analysis.keyFindings[].certainty", 2_000],
  ["analysis.keyFindings[].evidence.quote", 10_000],
  ["analysis.keyFindings[].evidence.paraphrase", 20_000],
  ["analysis.keyFindings[].evidence.context", 20_000],
  ["analysis.sectionSummaries[].heading", 500],
  ["analysis.sectionSummaries[].summary", 30_000],
  ["analysis.sectionSummaries[].keyPoints[]", 5_000],
  ["analysis.sectionSummaries[].evidence[].quote", 10_000],
  ["analysis.sectionSummaries[].evidence[].paraphrase", 20_000],
  ["analysis.sectionSummaries[].evidence[].context", 20_000],
  ["analysis.figures[].label", 200],
  ["analysis.figures[].title", 1_000],
  ["analysis.figures[].description", 20_000],
  ["analysis.figures[].interpretation", 20_000],
  ["analysis.figures[].keyTakeaway", 20_000],
  ["analysis.figures[].evidence.quote", 10_000],
  ["analysis.figures[].evidence.paraphrase", 20_000],
  ["analysis.figures[].evidence.context", 20_000],
  ["analysis.figures[].limitations[]", 5_000],
  ["analysis.tables[].label", 200],
  ["analysis.tables[].title", 1_000],
  ["analysis.tables[].description", 20_000],
  ["analysis.tables[].interpretation", 20_000],
  ["analysis.tables[].keyTakeaway", 20_000],
  ["analysis.tables[].evidence.quote", 10_000],
  ["analysis.tables[].evidence.paraphrase", 20_000],
  ["analysis.tables[].evidence.context", 20_000],
  ["analysis.tables[].limitations[]", 5_000],
  ["analysis.tables[].columns[]", 1_000],
  ["analysis.equations[].label", 200],
  ["analysis.equations[].latex", 20_000],
  ["analysis.equations[].plainLanguage", 20_000],
  ["analysis.equations[].role", 10_000],
  ["analysis.equations[].variables[].symbol", 500],
  ["analysis.equations[].variables[].meaning", 5_000],
  ["analysis.equations[].evidence.quote", 10_000],
  ["analysis.equations[].evidence.paraphrase", 20_000],
  ["analysis.equations[].evidence.context", 20_000],
  ["analysis.limitations[].limitation", 20_000],
  ["analysis.limitations[].impact", 20_000],
  ["analysis.limitations[].evidence.quote", 10_000],
  ["analysis.limitations[].evidence.paraphrase", 20_000],
  ["analysis.limitations[].evidence.context", 20_000],
  ["analysis.glossary[].term", 500],
  ["analysis.glossary[].definition", 10_000],
  ["analysis.references[].citation", 10_000],
  ["analysis.references[].doi", 512],
  ["analysis.references[].url", 2_048],
  ["analysis.sourceLedger[].id", 240],
  ["analysis.sourceLedger[].title", 1_000],
  ["analysis.sourceLedger[].claim", 20_000],
  ["analysis.sourceLedger[].quote", 10_000],
  ["analysis.sourceLedger[].paraphrase", 20_000],
  ["analysis.sourceLedger[].context", 20_000],
  ["analysis.synthesis.contribution", 50_000],
  ["analysis.synthesis.novelty", 50_000],
  ["analysis.synthesis.implications[]", 10_000],
  ["analysis.synthesis.openQuestions[]", 10_000],
  ["analysis.warnings[]", 5_000],
]);

/** A safe, value-free error for malformed model output. */
export class StructuredOutputValidationError extends Error {
  readonly path: string;

  constructor(path: string) {
    super("The AI service returned structured data that does not match the required contract.");
    this.name = "StructuredOutputValidationError";
    this.path = path;
  }
}

function runtimeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number" && Number.isInteger(value)) return "integer";
  return typeof value;
}

function fail(path: string): never {
  throw new StructuredOutputValidationError(path);
}

function validateRuntimeSchema(value: unknown, schema: RuntimeSchema, path: string): void {
  const allowedTypes = typeof schema.type === "string"
    ? [schema.type]
    : schema.type;
  const actualType = runtimeType(value);
  if (allowedTypes && !allowedTypes.includes(actualType)) fail(path);
  if (schema.enum && !schema.enum.includes(value)) fail(path);

  if (typeof value === "string") {
    const normalizedPath = path.replace(/\[\d+\]/g, "[]");
    const runtimeMaximum = RUNTIME_STRING_MAXIMUMS.get(normalizedPath);
    if (runtimeMaximum !== undefined && value.length > runtimeMaximum) fail(path);
    if (schema.minLength !== undefined && value.length < schema.minLength) fail(path);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) fail(path);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(value)) fail(path);
    return;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(path);
    if (allowedTypes?.includes("integer") && !Number.isInteger(value)) fail(path);
    if (schema.minimum !== undefined && value < schema.minimum) fail(path);
    if (schema.maximum !== undefined && value > schema.maximum) fail(path);
    return;
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail(path);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(path);
    if (schema.items) value.forEach((item, index) => validateRuntimeSchema(item, schema.items!, `${path}[${index}]`));
    return;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) fail(`${path}.${key}`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) fail(`${path}.${key}`);
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(record, key)) {
        validateRuntimeSchema(record[key], childSchema, `${path}.${key}`);
      }
    }
  }
}

function assertHttpsUrl(value: unknown, path: string): void {
  if (value === null) return;
  if (typeof value !== "string") fail(path);
  try {
    if (new URL(value).protocol !== "https:") fail(path);
  } catch {
    fail(path);
  }
}

/**
 * Defense-in-depth validation for decoded analysis output. This mirrors the
 * frontend PaperAnalysisSchema without importing browser code into the API.
 */
export function parsePaperAnalysisResult(value: unknown): Record<string, unknown> {
  validateRuntimeSchema(value, paperAnalysisJsonSchema, "analysis");
  const analysis = value as Record<string, unknown>;
  const publication = analysis.publication as Record<string, unknown>;
  assertHttpsUrl(publication.url, "analysis.publication.url");

  const references = analysis.references as Array<Record<string, unknown>>;
  references.forEach((reference, index) => {
    assertHttpsUrl(reference.url, `analysis.references[${index}].url`);
  });

  const sections = analysis.sectionSummaries as Array<Record<string, unknown>>;
  sections.forEach((section, index) => {
    if ((section.endPage as number) < (section.startPage as number)) {
      fail(`analysis.sectionSummaries[${index}].endPage`);
    }
  });

  return analysis;
}
