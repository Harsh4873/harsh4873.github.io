# Fare

Fare is Harsh Dave's private, local-first calorie and macro tracker, published at `harsh.bet/fare/` from the isolated `fare` branch of PickLedgerPro.

## Product model

- **Usuals first:** personal suggestions rank query match, meal/time context, frequency, recency, weekday, and pins before any public-database result.
- **Immutable history:** every diary entry stores its own nutrition and serving snapshot. Editing a saved food or an upstream catalog record never rewrites an earlier day.
- **Flexible logging:** repeat a food, copy a meal or day, quick-add calories/macros, create custom foods, save meal templates, scan or type a barcode, or explicitly search Open Food Facts.
- **Useful review:** day totals, remaining targets, macro bars, meal contribution, weekly averages, logged-day completeness, and frequently reused foods.
- **Private sync:** the local IndexedDB/localStorage mirror works signed out. Optional Google sign-in syncs only the approved account through Firebase and keeps Fare isolated from the other harsh.bet apps.
- **Portable data:** JSON backup/import plus CSV diary export.

Targets are always user-entered. Fare does not prescribe calorie deficits, macro plans, or medical nutrition guidance.

## Food data

Fare searches personal history instantly. Public search happens only after an explicit request because Open Food Facts limits searches and specifically warns against search-as-you-type. Barcode reads use the current product endpoint. Every imported result keeps its source, serving basis, fetch time, and a data-quality note so it can be reviewed before logging.

- Open Food Facts API: <https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/>
- Open Food Facts database licensing/attribution: <https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/tutorials/license-be-on-the-legal-side/>
- USDA FoodData Central is not called from the browser because its API key must remain private: <https://fdc.nal.usda.gov/api-guide/>

The app does not display or redistribute product images. Public nutrition data remains visually separated from the private diary and saved-food collection.

## Sync model

Foods, meal templates, and diary entries are individual Firestore documents under `fare_users/{uid}`. Profile, targets, and settings are independent singleton documents. Records merge by `updatedAt` with a deterministic tie-break, and deletes are durable tombstones so an offline device cannot resurrect them. Safe sign-out waits for pending writes before clearing this app's local copy and named Firestore cache.

`firestore.rules` carries the complete shared ruleset for Daymark, Slate, and Fare because a Firebase rules deployment replaces the project-wide ruleset. Keep the file identical on all three branches.

## Development

```sh
npm ci
npm test
npm run test:rules
npm run typecheck
npm run build
```

The Vite base, manifest scope, service worker scope, canonical URL, and app icons all use `/fare/`. Main's Pages workflow checks out the `fare` branch, builds it, verifies the app artifact and touch icon, and copies it into `dist/fare/`.
