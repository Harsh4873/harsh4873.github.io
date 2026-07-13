import type {
  Nutrition,
  NutritionDataQuality,
  NutritionProvenance,
  Serving,
} from './model';

export const OPEN_FOOD_FACTS_BASE_URL = 'https://world.openfoodfacts.org';

const SEARCH_FIELDS = [
  'code',
  'product_name',
  'generic_name',
  'brands',
  'serving_size',
  'serving_quantity',
  'product_quantity_unit',
  'nutriments',
  'image_front_small_url',
  'image_front_url',
  'categories_tags',
  'nutrition_grades',
  'completeness',
  'states_tags',
  'last_modified_t',
].join(',');

const PRODUCT_FIELDS = [
  'code',
  'product_name',
  'generic_name',
  'brands',
  'serving_size',
  'serving_quantity',
  'serving_quantity_unit',
  'nutrition_data_per',
  'nutrition',
  'categories_tags',
  'nutrition_grades',
  'completeness',
  'states_tags',
  'last_modified_t',
].join(',');

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface OpenFoodFactsProduct {
  readonly barcode: string;
  readonly name: string;
  readonly brand?: string;
  readonly imageUrl?: string;
  readonly serving: Serving;
  readonly nutritionPerServing: Nutrition;
  readonly provenance: NutritionProvenance;
  readonly categories: readonly string[];
  readonly nutriScore?: string;
  readonly completeness?: number;
}

export interface OpenFoodFactsSearchResult {
  readonly query: string;
  readonly products: readonly OpenFoodFactsProduct[];
  readonly total: number;
}

export interface ExplicitSearchOptions {
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

export interface BarcodeLookupOptions {
  readonly signal?: AbortSignal;
}

export interface OpenFoodFactsClientOptions {
  readonly fetch?: FetchLike;
  readonly now?: () => number;
  readonly baseUrl?: string;
  readonly searchCacheMs?: number;
  readonly productCacheMs?: number;
}

export class OpenFoodFactsRateLimitError extends Error {
  readonly endpoint: 'search' | 'product';
  readonly retryAfterMs: number;

  constructor(endpoint: 'search' | 'product', retryAfterMs: number) {
    super(
      `Open Food Facts ${endpoint} limit reached; retry in ${Math.ceil(retryAfterMs / 1_000)}s`,
    );
    this.name = 'OpenFoodFactsRateLimitError';
    this.endpoint = endpoint;
    this.retryAfterMs = retryAfterMs;
  }
}

export class OpenFoodFactsRequestError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'OpenFoodFactsRequestError';
    this.status = status;
  }
}

class RollingWindowLimiter {
  private timestamps: number[] = [];

  constructor(
    private readonly maximum: number,
    private readonly windowMs: number,
    private readonly endpoint: 'search' | 'product',
    private readonly now: () => number,
  ) {}

  take(): void {
    const current = this.now();
    this.timestamps = this.timestamps.filter(
      (timestamp) => current - timestamp < this.windowMs,
    );
    if (this.timestamps.length >= this.maximum) {
      const retryAfterMs = Math.max(
        0,
        this.windowMs - (current - this.timestamps[0]),
      );
      throw new OpenFoodFactsRateLimitError(this.endpoint, retryAfterMs);
    }
    this.timestamps.push(current);
  }
}

interface CacheEntry<T> {
  readonly expiresAt: number;
  readonly value: T;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function number(value: unknown): number | undefined {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function nonNegative(value: unknown): number {
  return Math.max(0, number(value) ?? 0);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => (text(item) ? [text(item) as string] : []))
    : [];
}

function stripLanguageTag(value: string): string {
  return value.replace(/^[a-z]{2}:/, '').replace(/-/g, ' ');
}

function normalizeBarcode(value: string): string {
  const barcode = value.replace(/[\s-]/g, '');
  if (!/^\d{4,24}$/.test(barcode)) {
    throw new RangeError('Barcode must contain 4–24 digits');
  }
  return barcode;
}

function nutritionFrom(
  nutriments: Record<string, unknown>,
  suffix: '_serving' | '_100g',
): Nutrition {
  const calories = number(nutriments[`energy-kcal${suffix}`])
    ?? number(nutriments[`energy_kcal${suffix}`])
    ?? ((number(nutriments[`energy-kj${suffix}`])
      ?? number(nutriments[`energy${suffix}`])) ?? 0) / 4.184;
  return {
    calories: Math.max(0, calories),
    proteinG: nonNegative(nutriments[`proteins${suffix}`]),
    carbsG: nonNegative(nutriments[`carbohydrates${suffix}`]),
    fatG: nonNegative(nutriments[`fat${suffix}`]),
    saturatedFatG: nonNegative(nutriments[`saturated-fat${suffix}`]),
    fiberG: nonNegative(nutriments[`fiber${suffix}`]),
    sugarG: nonNegative(nutriments[`sugars${suffix}`]),
    // Open Food Facts reports sodium in grams.
    sodiumMg: nonNegative(nutriments[`sodium${suffix}`]) * 1_000,
  };
}

function nutritionFromV3(product: Record<string, unknown>): Nutrition | undefined {
  const nutrition = asRecord(product.nutrition);
  const aggregated = asRecord(nutrition?.aggregated_set);
  const nutrients = asRecord(aggregated?.nutrients);
  if (!nutrients) return undefined;
  const nutrient = (name: string) => number(asRecord(nutrients[name])?.value) ?? 0;
  const result: Nutrition = {
    calories: Math.max(0, nutrient('energy-kcal') || nutrient('energy') / 4.184),
    proteinG: Math.max(0, nutrient('proteins')),
    carbsG: Math.max(0, nutrient('carbohydrates')),
    fatG: Math.max(0, nutrient('fat')),
    saturatedFatG: Math.max(0, nutrient('saturated-fat')),
    fiberG: Math.max(0, nutrient('fiber')),
    sugarG: Math.max(0, nutrient('sugars')),
    sodiumMg: Math.max(0, nutrient('sodium') * 1_000),
  };
  return hasUsefulNutrition(result) ? result : undefined;
}

function multiplyNutrition(nutrition: Nutrition, multiplier: number): Nutrition {
  return Object.fromEntries(Object.entries(nutrition).map(([key, value]) => [key, value * multiplier])) as unknown as Nutrition;
}

function hasUsefulNutrition(nutrition: Nutrition): boolean {
  return Object.values(nutrition).some((value) => value > 0);
}

function qualityFor(
  product: Record<string, unknown>,
  name: string,
  nutrition: Nutrition,
  hasServingNutrition: boolean,
): { quality: NutritionDataQuality; warnings: string[] } {
  const warnings: string[] = [];
  const coreMacroCount = [
    nutrition.calories,
    nutrition.proteinG,
    nutrition.carbsG,
    nutrition.fatG,
  ].filter((value) => value > 0).length;
  const completeness = number(product.completeness);
  const states = stringArray(product.states_tags);

  if (name === 'Unknown product') warnings.push('Product name is missing.');
  if (!hasUsefulNutrition(nutrition)) {
    warnings.push('Nutrition facts are missing.');
  } else if (coreMacroCount < 4) {
    warnings.push('One or more core nutrition fields are missing.');
  }
  if (!hasServingNutrition) {
    warnings.push('Serving nutrition is unavailable; values are shown per 100 g.');
  }
  warnings.push('Community-contributed data; compare with the package label.');

  const nutritionComplete = states.includes('en:nutrition-facts-completed');
  const quality: NutritionDataQuality =
    nutritionComplete && coreMacroCount === 4
      ? 'verified'
      : coreMacroCount === 4 && (completeness ?? 0) >= 0.7
        ? 'complete'
        : hasUsefulNutrition(nutrition)
          ? 'partial'
          : 'insufficient';
  return { quality, warnings };
}

/** Converts changing upstream payloads into Fare's narrow, durable shape. */
export function normalizeOpenFoodFactsProduct(
  rawValue: unknown,
  fetchedAt = new Date().toISOString(),
  fallbackBarcode?: string,
): OpenFoodFactsProduct | undefined {
  const product = asRecord(rawValue);
  if (!product) return undefined;
  const barcode = text(product.code) ?? fallbackBarcode;
  if (!barcode) return undefined;

  const name = text(product.product_name)
    ?? text(product.generic_name)
    ?? 'Unknown product';
  const nutriments = asRecord(product.nutriments) ?? {};
  const perServing = nutritionFrom(nutriments, '_serving');
  const legacyPer100 = nutritionFrom(nutriments, '_100g');
  const v3Per100 = nutritionFromV3(product);
  const servingQuantity = number(product.serving_quantity);
  const servingSize = text(product.serving_size);
  const hasLegacyServing = hasUsefulNutrition(perServing);
  const canScaleV3Serving = Boolean(v3Per100 && servingQuantity && servingQuantity > 0 && servingSize);
  const hasServingNutrition = hasLegacyServing || canScaleV3Serving;
  const nutritionPerServing = hasLegacyServing
    ? perServing
    : canScaleV3Serving
      ? multiplyNutrition(v3Per100 as Nutrition, (servingQuantity as number) / 100)
      : v3Per100 ?? legacyPer100;
  const servingLabel = hasServingNutrition
    ? servingSize ?? '1 serving'
    : '100 g';
  const quality = qualityFor(
    product,
    name,
    nutritionPerServing,
    hasServingNutrition,
  );
  const lastModifiedSeconds = number(product.last_modified_t);
  const lastModified = lastModifiedSeconds === undefined
    ? undefined
    : new Date(lastModifiedSeconds * 1_000).toISOString();
  const warnings = lastModified
    ? [...quality.warnings, `Upstream record last changed ${lastModified}.`]
    : quality.warnings;

  return Object.freeze({
    barcode,
    name,
    brand: text(product.brands),
    imageUrl: text(product.image_front_small_url) ?? text(product.image_front_url),
    serving: Object.freeze({
      quantity: hasServingNutrition
        ? Math.max(0, servingQuantity ?? 1)
        : 100,
      unit: hasServingNutrition
        ? text(product.serving_quantity_unit) ?? text(product.product_quantity_unit) ?? 'serving'
        : 'g',
      label: servingLabel,
    }),
    nutritionPerServing: Object.freeze(nutritionPerServing),
    provenance: Object.freeze({
      kind: 'open-food-facts' as const,
      providerName: 'Open Food Facts',
      externalId: barcode,
      sourceUrl: `${OPEN_FOOD_FACTS_BASE_URL}/product/${encodeURIComponent(barcode)}`,
      fetchedAt,
      dataQuality: quality.quality,
      warnings: Object.freeze(warnings),
    }),
    categories: Object.freeze(
      stringArray(product.categories_tags).map(stripLanguageTag),
    ),
    nutriScore: text(product.nutrition_grades)?.toUpperCase(),
    completeness: number(product.completeness),
  });
}

function responseProducts(value: unknown): unknown[] {
  const response = asRecord(value);
  return response && Array.isArray(response.products) ? response.products : [];
}

export class OpenFoodFactsClient {
  private readonly fetch: FetchLike;
  private readonly now: () => number;
  private readonly baseUrl: string;
  private readonly searchCacheMs: number;
  private readonly productCacheMs: number;
  private readonly searchLimiter: RollingWindowLimiter;
  private readonly productLimiter: RollingWindowLimiter;
  private readonly searchCache = new Map<string, CacheEntry<OpenFoodFactsSearchResult>>();
  private readonly productCache = new Map<string, CacheEntry<OpenFoodFactsProduct | null>>();

  constructor(options: OpenFoodFactsClientOptions = {}) {
    const platformFetch = globalThis.fetch?.bind(globalThis);
    if (!options.fetch && !platformFetch) {
      throw new Error('OpenFoodFactsClient requires fetch');
    }
    this.fetch = options.fetch ?? platformFetch as FetchLike;
    this.now = options.now ?? Date.now;
    this.baseUrl = (options.baseUrl ?? OPEN_FOOD_FACTS_BASE_URL).replace(/\/$/, '');
    this.searchCacheMs = options.searchCacheMs ?? 15 * 60_000;
    this.productCacheMs = options.productCacheMs ?? 24 * 60 * 60_000;
    this.searchLimiter = new RollingWindowLimiter(10, 60_000, 'search', this.now);
    this.productLimiter = new RollingWindowLimiter(15, 60_000, 'product', this.now);
  }

  private cached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  private async getJson(url: URL, signal?: AbortSignal): Promise<unknown> {
    const response = await this.fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-User-Agent': 'Fare/1.0 (https://harsh.bet/fare/)',
      },
      signal,
    });
    if (!response.ok) {
      throw new OpenFoodFactsRequestError(
        `Open Food Facts request failed (${response.status})`,
        response.status,
      );
    }
    return response.json() as Promise<unknown>;
  }

  /**
   * This method must be called only after an explicit submit/tap. Fare does not
   * invoke Open Food Facts while the user is typing (the API allows 10/min).
   */
  async searchOnSubmit(
    rawQuery: string,
    options: ExplicitSearchOptions = {},
  ): Promise<OpenFoodFactsSearchResult> {
    const query = rawQuery.trim().replace(/\s+/g, ' ');
    if (query.length < 2) {
      throw new RangeError('Enter at least two characters before searching');
    }
    const limit = Math.max(1, Math.min(20, Math.floor(options.limit ?? 10)));
    const cacheKey = `${query.toLocaleLowerCase()}|${limit}`;
    const cached = this.cached(this.searchCache, cacheKey);
    if (cached) return cached;

    this.searchLimiter.take();
    // Full text currently remains on the documented legacy endpoint. Keeping
    // it behind explicit submit avoids the API's prohibited typeahead pattern.
    const url = new URL('/cgi/search.pl', this.baseUrl);
    url.searchParams.set('search_terms', query);
    url.searchParams.set('search_simple', '1');
    url.searchParams.set('action', 'process');
    url.searchParams.set('json', '1');
    url.searchParams.set('page_size', String(limit));
    url.searchParams.set('page', '1');
    url.searchParams.set('fields', SEARCH_FIELDS);
    const payload = await this.getJson(url, options.signal);
    const response = asRecord(payload);
    const fetchedAt = new Date(this.now()).toISOString();
    const products = responseProducts(payload)
      .flatMap((raw) => {
        const product = normalizeOpenFoodFactsProduct(raw, fetchedAt);
        return product ? [product] : [];
      })
      .slice(0, limit);
    const result: OpenFoodFactsSearchResult = Object.freeze({
      query,
      products: Object.freeze(products),
      total: Math.max(products.length, number(response?.count) ?? products.length),
    });
    this.searchCache.set(cacheKey, {
      value: result,
      expiresAt: this.now() + this.searchCacheMs,
    });
    return result;
  }

  async lookupBarcode(
    rawBarcode: string,
    options: BarcodeLookupOptions = {},
  ): Promise<OpenFoodFactsProduct | null> {
    const barcode = normalizeBarcode(rawBarcode);
    const cached = this.cached(this.productCache, barcode);
    if (cached !== undefined) return cached;

    this.productLimiter.take();
    const url = new URL(
      `/api/v3.6/product/${encodeURIComponent(barcode)}.json`,
      this.baseUrl,
    );
    url.searchParams.set('fields', PRODUCT_FIELDS);
    let payload: unknown;
    try {
      payload = await this.getJson(url, options.signal);
    } catch (error) {
      if (error instanceof OpenFoodFactsRequestError && error.status === 404) {
        this.productCache.set(barcode, {
          value: null,
          expiresAt: this.now() + this.productCacheMs,
        });
        return null;
      }
      throw error;
    }

    const response = asRecord(payload);
    const rawProduct = response?.product;
    const status = number(response?.status);
    const product = status === 0 || rawProduct === undefined
      ? null
      : normalizeOpenFoodFactsProduct(
          rawProduct,
          new Date(this.now()).toISOString(),
          barcode,
        ) ?? null;
    this.productCache.set(barcode, {
      value: product,
      expiresAt: this.now() + this.productCacheMs,
    });
    return product;
  }

  clearCache(): void {
    this.searchCache.clear();
    this.productCache.clear();
  }
}
