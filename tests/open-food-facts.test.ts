import { describe, expect, it, vi } from 'vitest';
import {
  normalizeOpenFoodFactsProduct,
  OpenFoodFactsClient,
  OpenFoodFactsRateLimitError,
} from '../src/open-food-facts';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const rawProduct = {
  code: '0123456789012',
  product_name: 'Cafe Latte Protein Shake',
  brands: 'Premier Protein',
  serving_size: '1 bottle (325 ml)',
  serving_quantity: 325,
  product_quantity_unit: 'ml',
  nutriments: {
    'energy-kcal_serving': 160,
    proteins_serving: 30,
    carbohydrates_serving: 5,
    fat_serving: 3,
    'saturated-fat_serving': 1,
    fiber_serving: 1,
    sugars_serving: 1,
    sodium_serving: 0.4,
  },
  categories_tags: ['en:protein-shakes', 'en:beverages'],
  nutrition_grades: 'c',
  states_tags: ['en:nutrition-facts-completed'],
  completeness: 0.9,
};

describe('Open Food Facts normalization', () => {
  it('normalizes serving nutrition, provenance, and quality', () => {
    const product = normalizeOpenFoodFactsProduct(
      rawProduct,
      '2026-07-12T00:00:00.000Z',
    );
    expect(product).toMatchObject({
      barcode: '0123456789012',
      name: 'Cafe Latte Protein Shake',
      brand: 'Premier Protein',
      serving: { quantity: 325, unit: 'ml', label: '1 bottle (325 ml)' },
      nutritionPerServing: {
        calories: 160,
        proteinG: 30,
        sodiumMg: 400,
      },
      provenance: {
        kind: 'open-food-facts',
        dataQuality: 'verified',
        fetchedAt: '2026-07-12T00:00:00.000Z',
      },
      categories: ['protein shakes', 'beverages'],
      nutriScore: 'C',
    });
  });

  it('falls back to 100 g values and exposes a data warning', () => {
    const product = normalizeOpenFoodFactsProduct({
      code: '1234',
      product_name: 'Incomplete food',
      nutriments: {
        'energy-kcal_100g': 200,
        proteins_100g: 10,
        sodium_100g: 0.2,
      },
    });
    expect(product?.serving).toEqual({ quantity: 100, unit: 'g', label: '100 g' });
    expect(product?.nutritionPerServing.sodiumMg).toBe(200);
    expect(product?.provenance.dataQuality).toBe('partial');
    expect(product?.provenance.warnings).toContain(
      'Serving nutrition is unavailable; values are shown per 100 g.',
    );
  });

  it('normalizes the current v3 nutrition shape into the labeled serving', () => {
    const product = normalizeOpenFoodFactsProduct({
      code: '0643843716686',
      product_name: 'Café Latte Protein Shake',
      brands: 'Premier Protein',
      serving_size: '1 portion (11 fl oz)',
      serving_quantity: 325.3085,
      serving_quantity_unit: 'g',
      nutrition: {
        aggregated_set: {
          nutrients: {
            'energy-kcal': { value: 49.1841577827782 },
            proteins: { value: 9.22202958427091 },
            carbohydrates: { value: 1.22960394456945 },
            fat: { value: 0.922202958427091 },
            sodium: { value: 0.26 },
          },
        },
      },
    });
    expect(product?.serving).toEqual({ quantity: 325.3085, unit: 'g', label: '1 portion (11 fl oz)' });
    expect(product?.nutritionPerServing.calories).toBeCloseTo(160);
    expect(product?.nutritionPerServing.proteinG).toBeCloseTo(30);
    expect(product?.nutritionPerServing.sodiumMg).toBeCloseTo(845.8, 0);
  });
});

describe('OpenFoodFactsClient', () => {
  it('searches only through the explicit-submit method and caches exact queries', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request) =>
      jsonResponse({ count: 1, products: [rawProduct] }),
    );
    const client = new OpenFoodFactsClient({
      fetch,
      now: () => Date.parse('2026-07-12T00:00:00.000Z'),
    });

    const first = await client.searchOnSubmit('  protein   shake ', { limit: 5 });
    const second = await client.searchOnSubmit('protein shake', { limit: 5 });
    expect(first.products).toHaveLength(1);
    expect(second).toBe(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetch.mock.calls[0][0]));
    expect(url.pathname).toBe('/cgi/search.pl');
    expect(url.searchParams.get('search_terms')).toBe('protein shake');
    expect(url.searchParams.get('page_size')).toBe('5');
    await expect(client.searchOnSubmit('x')).rejects.toThrow(/at least two/i);
  });

  it('looks up and caches barcodes using the current product API', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request) =>
      jsonResponse({ product: rawProduct }),
    );
    const client = new OpenFoodFactsClient({ fetch });
    const first = await client.lookupBarcode('0123-4567-89012');
    const second = await client.lookupBarcode('0123456789012');
    expect(first?.name).toBe('Cafe Latte Protein Shake');
    expect(second).toBe(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toContain(
      '/api/v3.6/product/0123456789012.json',
    );
    await expect(client.lookupBarcode('not-a-barcode')).rejects.toThrow(/digits/i);
  });

  it('returns null for not-found products and caches that result', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request) =>
      jsonResponse({}, 404),
    );
    const client = new OpenFoodFactsClient({ fetch });
    expect(await client.lookupBarcode('12345678')).toBeNull();
    expect(await client.lookupBarcode('12345678')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('enforces ten uncached searches per rolling minute', async () => {
    let now = 0;
    const fetch = vi.fn(async (_input: string | URL | Request) =>
      jsonResponse({ count: 0, products: [] }),
    );
    const client = new OpenFoodFactsClient({ fetch, now: () => now });
    for (let index = 0; index < 10; index += 1) {
      await client.searchOnSubmit(`query ${index}`);
    }
    await expect(client.searchOnSubmit('query overflow')).rejects.toMatchObject({
      endpoint: 'search',
      retryAfterMs: 60_000,
    } satisfies Partial<OpenFoodFactsRateLimitError>);
    now = 60_000;
    await expect(client.searchOnSubmit('query reset')).resolves.toBeDefined();
  });

  it('enforces fifteen uncached product reads per rolling minute', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request) =>
      jsonResponse({ status: 0 }),
    );
    const client = new OpenFoodFactsClient({ fetch, now: () => 0 });
    for (let index = 0; index < 15; index += 1) {
      await client.lookupBarcode(String(10_000 + index));
    }
    await expect(client.lookupBarcode('99999')).rejects.toBeInstanceOf(
      OpenFoodFactsRateLimitError,
    );
  });
});
