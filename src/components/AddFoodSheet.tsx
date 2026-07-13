import {
  AlertTriangle,
  ArrowLeft,
  Clock3,
  Database,
  LoaderCircle,
  Minus,
  PackageSearch,
  Plus,
  ScanBarcode,
  Search,
  Sparkles,
  UtensilsCrossed,
  Zap,
} from 'lucide-react';
import {
  type CSSProperties,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { rankUsuals, type UsualSuggestion } from '../memory';
import {
  createNutritionSnapshot,
  type FareState,
  type Food,
  type MealSlot,
  type Nutrition,
  type NutritionDataQuality,
  type NutritionProvenance,
  type SavedMeal,
} from '../model';
import {
  OpenFoodFactsClient,
  OpenFoodFactsRateLimitError,
  type OpenFoodFactsProduct,
} from '../open-food-facts';
import { addNutrition, scaleNutrition } from '../nutrition';
import type { FareStore } from '../store';
import {
  BottomSheet,
  EmptyState,
  Panel,
  SegmentedControl,
  SourceBadge,
  type SourceKind,
} from '../ui';
import { BarcodeScanner } from './BarcodeScanner';

type Lane = 'usuals' | 'search' | 'quick' | 'custom' | 'meals';
type LoadingKind = 'search' | 'barcode' | null;
type Selection =
  | { kind: 'food'; food: Food }
  | { kind: 'api'; product: OpenFoodFactsProduct };

export interface AddFoodSheetProps {
  open: boolean;
  onClose: () => void;
  state: FareState;
  store: FareStore;
  dateKey: string;
  defaultMealSlot: MealSlot;
  onToast: (message: string) => void;
}

const LANES = [
  { value: 'usuals', label: 'Usuals', icon: <Sparkles /> },
  { value: 'search', label: 'Search', icon: <Search /> },
  { value: 'quick', label: 'Quick add', icon: <Zap /> },
  { value: 'custom', label: 'Create', icon: <Plus /> },
  { value: 'meals', label: 'Meals', icon: <UtensilsCrossed /> },
] as const;

const MEAL_SLOTS: ReadonlyArray<{ value: MealSlot; label: string }> = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snack', label: 'Snack' },
  { value: 'other', label: 'Other' },
];

const EMPTY_NUMBERS = {
  calories: '',
  proteinG: '',
  carbsG: '',
  fatG: '',
  saturatedFatG: '',
  fiberG: '',
  sugarG: '',
  sodiumMg: '',
};

const stack: CSSProperties = { display: 'grid', gap: 16 };
const compactStack: CSSProperties = { display: 'grid', gap: 10 };
const row: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
};
const muted: CSSProperties = { color: 'var(--text-muted)', fontSize: 12, margin: 0 };

function nonNegative(raw: string): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function positive(raw: string, fallback = 1): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nutritionFromFields(fields: typeof EMPTY_NUMBERS): Nutrition {
  return {
    calories: nonNegative(fields.calories),
    proteinG: nonNegative(fields.proteinG),
    carbsG: nonNegative(fields.carbsG),
    fatG: nonNegative(fields.fatG),
    saturatedFatG: nonNegative(fields.saturatedFatG),
    fiberG: nonNegative(fields.fiberG),
    sugarG: nonNegative(fields.sugarG),
    sodiumMg: nonNegative(fields.sodiumMg),
  };
}

function sourceKind(provenance: NutritionProvenance): SourceKind {
  if (provenance.dataQuality === 'verified') return 'verified';
  if (provenance.kind === 'open-food-facts') {
    return provenance.dataQuality === 'complete' ? 'database' : 'estimated';
  }
  if (provenance.kind === 'saved-food' || provenance.kind === 'saved-meal') return 'history';
  return 'custom';
}

function qualityLabel(quality: NutritionDataQuality) {
  return quality === 'verified'
    ? 'High completeness'
    : quality === 'complete'
      ? 'Complete macros'
      : quality === 'partial'
        ? 'Partial nutrition'
        : 'Nutrition incomplete';
}

function formatAmount(value: number, digits = 0) {
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function NutritionLine({ nutrition }: { nutrition: Nutrition }) {
  return (
    <div className="food-result__nutrition" aria-label="Nutrition summary">
      <span><strong>{formatAmount(nutrition.calories)}</strong> kcal</span>
      <span><strong>{formatAmount(nutrition.proteinG, 1)}g</strong> protein</span>
      <span><strong>{formatAmount(nutrition.carbsG, 1)}g</strong> carbs</span>
      <span><strong>{formatAmount(nutrition.fatG, 1)}g</strong> fat</span>
    </div>
  );
}

function ProvenanceNote({ provenance }: { provenance: NutritionProvenance }) {
  return (
    <Panel variant="soft" padding="compact" style={compactStack}>
      <div style={row}>
        <SourceBadge source={sourceKind(provenance)} label={`${provenance.providerName} · ${qualityLabel(provenance.dataQuality)}`} />
        {provenance.sourceUrl ? (
          <a
            className="text-button"
            href={provenance.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            Source
          </a>
        ) : null}
      </div>
      {provenance.warnings.length > 0 ? (
        <div className="notice notice--warning" role="note">
          <AlertTriangle size={17} aria-hidden="true" />
          <div>
            {provenance.warnings.map((warning) => <div key={warning}>{warning}</div>)}
          </div>
        </div>
      ) : (
        <p style={muted}>Nutrition is stored as a snapshot when you log it, so earlier diary entries never change silently.</p>
      )}
    </Panel>
  );
}

function FoodResult({
  name,
  brand,
  servingLabel,
  nutrition,
  provenance,
  detail,
  onSelect,
}: {
  name: string;
  brand?: string;
  servingLabel: string;
  nutrition: Nutrition;
  provenance: NutritionProvenance;
  detail?: string;
  onSelect: () => void;
}) {
  return (
    <div className="food-result">
      <div>
        <div className="food-result__name">{name}</div>
        <div className="food-result__brand">
          {[brand, servingLabel, detail].filter(Boolean).join(' · ')}
        </div>
        <NutritionLine nutrition={nutrition} />
        <div style={{ marginTop: 8 }}>
          <SourceBadge source={sourceKind(provenance)} label={provenance.providerName} />
        </div>
      </div>
      <div className="food-result__actions">
        <button type="button" className="button button--secondary button--small" onClick={onSelect}>
          Add
        </button>
      </div>
    </div>
  );
}

function mealNutrition(meal: SavedMeal): Nutrition {
  return addNutrition(...meal.items.map((item) =>
    scaleNutrition(item.snapshot.nutritionPerServing, item.servings),
  ));
}

function friendlyApiError(error: unknown) {
  if (!navigator.onLine) return 'You are offline. Local foods and Usuals still work.';
  if (error instanceof OpenFoodFactsRateLimitError) {
    return `Open Food Facts needs a short pause. Try again in ${Math.max(1, Math.ceil(error.retryAfterMs / 1_000))} seconds.`;
  }
  if (error instanceof RangeError) return error.message;
  return 'Open Food Facts could not be reached. Your local Fare data is unchanged.';
}

export function AddFoodSheet({
  open,
  onClose,
  state,
  store,
  dateKey,
  defaultMealSlot,
  onToast,
}: AddFoodSheetProps) {
  const apiRef = useRef<OpenFoodFactsClient | null>(null);
  if (!apiRef.current) apiRef.current = new OpenFoodFactsClient();

  const requestRef = useRef<AbortController | null>(null);
  const [lane, setLane] = useState<Lane>('usuals');
  const [mealSlot, setMealSlot] = useState<MealSlot>(defaultMealSlot);
  const [query, setQuery] = useState('');
  const [apiQuery, setApiQuery] = useState('');
  const [apiProducts, setApiProducts] = useState<readonly OpenFoodFactsProduct[]>([]);
  const [loading, setLoading] = useState<LoadingKind>(null);
  const [error, setError] = useState<string>();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [selection, setSelection] = useState<Selection>();
  const [servings, setServings] = useState('1');
  const [note, setNote] = useState('');
  const [quickName, setQuickName] = useState('Quick add');
  const [quickFields, setQuickFields] = useState({ ...EMPTY_NUMBERS });
  const [customName, setCustomName] = useState('');
  const [customBrand, setCustomBrand] = useState('');
  const [servingQuantity, setServingQuantity] = useState('1');
  const [servingUnit, setServingUnit] = useState('serving');
  const [servingLabel, setServingLabel] = useState('1 serving');
  const [customFields, setCustomFields] = useState({ ...EMPTY_NUMBERS });

  const localUsuals = useMemo(() => rankUsuals(state, {
    dateKey,
    mealSlot,
    minuteOfDay: new Date().getHours() * 60 + new Date().getMinutes(),
    limit: 10,
  }), [dateKey, mealSlot, state]);

  const localResults = useMemo(() => {
    if (!query.trim()) return [];
    return rankUsuals(state, {
      dateKey,
      mealSlot,
      minuteOfDay: new Date().getHours() * 60 + new Date().getMinutes(),
      query,
      limit: 20,
    });
  }, [dateKey, mealSlot, query, state]);

  const savedMeals = useMemo(() => state.meals
    .filter((meal) => !meal.deleted)
    .sort((left, right) => Number(right.pinned) - Number(left.pinned) || left.name.localeCompare(right.name)), [state.meals]);

  useEffect(() => {
    if (open) {
      setMealSlot(defaultMealSlot);
      setLane('usuals');
      setSelection(undefined);
      setError(undefined);
      setServings('1');
      setNote('');
      return;
    }
    requestRef.current?.abort();
    requestRef.current = null;
    setScannerOpen(false);
    setLoading(null);
  }, [defaultMealSlot, open]);

  useEffect(() => () => requestRef.current?.abort(), []);

  function closeSheet() {
    requestRef.current?.abort();
    requestRef.current = null;
    setScannerOpen(false);
    setSelection(undefined);
    setLoading(null);
    onClose();
  }

  function beginFood(food: Food) {
    setSelection({ kind: 'food', food });
    setServings('1');
    setNote('');
    setError(undefined);
  }

  function beginProduct(product: OpenFoodFactsProduct) {
    setSelection({ kind: 'api', product });
    setServings('1');
    setNote('');
    setError(undefined);
  }

  function logMeal(meal: SavedMeal) {
    const entries = store.logMeal(meal, { dateKey, mealSlot });
    if (entries.length === 0) {
      setError('This saved meal does not contain any foods yet.');
      return;
    }
    onToast(`${meal.name} added to ${mealSlot}.`);
    closeSheet();
  }

  function selectUsual(suggestion: UsualSuggestion) {
    if (suggestion.food) beginFood(suggestion.food);
    else if (suggestion.meal) logMeal(suggestion.meal);
  }

  async function searchDatabase(event: FormEvent) {
    event.preventDefault();
    const submitted = query.trim();
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading('search');
    setError(undefined);
    try {
      const result = await apiRef.current!.searchOnSubmit(submitted, {
        limit: 12,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setApiQuery(result.query);
      setApiProducts(result.products);
      if (result.products.length === 0) {
        setError(`No Open Food Facts products matched “${result.query}”. Try a brand name or scan the package.`);
      }
    } catch (nextError) {
      if (!controller.signal.aborted) setError(friendlyApiError(nextError));
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(null);
      }
    }
  }

  const lookupBarcode = useCallback(async (barcode: string) => {
    setScannerOpen(false);
    setLane('search');
    setError(undefined);

    const saved = state.foods.find((food) => !food.deleted && food.barcode === barcode);
    if (saved) {
      beginFood(saved);
      onToast('Found this barcode in your Fare library.');
      return;
    }

    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading('barcode');
    try {
      const product = await apiRef.current!.lookupBarcode(barcode, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!product) {
        setError('That barcode is not in Open Food Facts yet. Create the food manually instead.');
        setLane('custom');
        return;
      }
      beginProduct(product);
    } catch (nextError) {
      if (!controller.signal.aborted) setError(friendlyApiError(nextError));
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(null);
      }
    }
  }, [onToast, state.foods]);

  function confirmFood() {
    if (!selection) return;
    const count = positive(servings, 0);
    if (count <= 0) {
      setError('Enter a serving amount greater than zero.');
      return;
    }

    let food: Food | undefined;
    if (selection.kind === 'food') {
      food = selection.food;
    } else {
      const product = selection.product;
      food = state.foods.find((candidate) =>
        !candidate.deleted && candidate.barcode === product.barcode,
      );
      food ??= store.addFood({
        name: product.name,
        brand: product.brand,
        aliases: product.categories.slice(0, 6),
        imageUrl: product.imageUrl,
        barcode: product.barcode,
        serving: {
          ...product.serving,
          quantity: Math.max(0.000001, product.serving.quantity),
        },
        nutritionPerServing: product.nutritionPerServing,
        provenance: product.provenance,
        pinned: false,
      });
    }

    if (!food) {
      setError('Fare could not save this food. Try again.');
      return;
    }
    const entry = store.logFood(food, {
      dateKey,
      mealSlot,
      servings: count,
      note: note.trim() || undefined,
    });
    if (!entry) {
      setError('Fare could not add this diary entry. Try again.');
      return;
    }
    onToast(`${food.name} added to ${mealSlot}.`);
    closeSheet();
  }

  function submitQuickAdd(event: FormEvent) {
    event.preventDefault();
    const nutrition = nutritionFromFields(quickFields);
    if (nutrition.calories <= 0) {
      setError('Enter calories for this quick add.');
      return;
    }
    const hasMacros = nutrition.proteinG > 0 || nutrition.carbsG > 0 || nutrition.fatG > 0;
    const warnings = hasMacros ? [] : ['Macros were not entered for this quick add.'];
    const name = quickName.trim() || 'Quick add';
    const entry = store.addEntry({
      dateKey,
      consumedAt: new Date().toISOString(),
      mealSlot,
      origin: 'quick-add',
      snapshot: createNutritionSnapshot({
        name,
        serving: { quantity: 1, unit: 'entry', label: '1 quick entry' },
        servings: 1,
        nutritionPerServing: nutrition,
        nutrition,
        provenance: {
          kind: 'manual',
          providerName: 'Fare quick add',
          dataQuality: hasMacros ? 'complete' : 'partial',
          warnings,
        },
      }),
    });
    if (!entry) {
      setError('Fare could not add this diary entry. Try again.');
      return;
    }
    onToast(`${name} added to ${mealSlot}.`);
    closeSheet();
  }

  function submitCustomFood(event: FormEvent) {
    event.preventDefault();
    const name = customName.trim();
    if (!name) {
      setError('Give this food a name.');
      return;
    }
    const quantity = positive(servingQuantity, 0);
    if (quantity <= 0 || !servingUnit.trim() || !servingLabel.trim()) {
      setError('Complete the serving amount, unit, and label.');
      return;
    }
    const nutrition = nutritionFromFields(customFields);
    if (nutrition.calories <= 0) {
      setError('Enter calories per serving.');
      return;
    }
    const macroCount = [nutrition.proteinG, nutrition.carbsG, nutrition.fatG]
      .filter((value) => value > 0).length;
    const warnings = macroCount < 3 ? ['One or more core macros were left at zero.'] : [];
    const food = store.addFood({
      name,
      brand: customBrand.trim() || undefined,
      aliases: [],
      serving: {
        quantity,
        unit: servingUnit.trim(),
        label: servingLabel.trim(),
      },
      nutritionPerServing: nutrition,
      provenance: {
        kind: 'manual',
        providerName: 'Fare custom food',
        dataQuality: macroCount === 3 ? 'complete' : 'partial',
        warnings,
      },
      pinned: false,
    });
    if (!food) {
      setError('Fare could not save this food. Try again.');
      return;
    }
    setCustomName('');
    setCustomBrand('');
    setCustomFields({ ...EMPTY_NUMBERS });
    beginFood(food);
    onToast(`${food.name} saved to your Fare library.`);
  }

  const selectedName = selection?.kind === 'food' ? selection.food.name : selection?.product.name;
  const selectedBrand = selection?.kind === 'food' ? selection.food.brand : selection?.product.brand;
  const selectedServing = selection?.kind === 'food' ? selection.food.serving : selection?.product.serving;
  const selectedNutrition = selection?.kind === 'food'
    ? selection.food.nutritionPerServing
    : selection?.product.nutritionPerServing;
  const selectedProvenance = selection?.kind === 'food'
    ? selection.food.provenance
    : selection?.product.provenance;
  const servingCount = positive(servings, 1);

  function renderSuggestion(suggestion: UsualSuggestion) {
    const nutrition = suggestion.food
      ? suggestion.food.nutritionPerServing
      : suggestion.meal
        ? mealNutrition(suggestion.meal)
        : undefined;
    if (!nutrition) return null;
    return (
      <FoodResult
        key={`${suggestion.kind}-${suggestion.id}`}
        name={suggestion.name}
        brand={suggestion.brand}
        servingLabel={suggestion.kind === 'meal' ? `${suggestion.meal?.items.length ?? 0} foods` : suggestion.food?.serving.label ?? '1 serving'}
        nutrition={nutrition}
        provenance={suggestion.food?.provenance ?? {
          kind: 'saved-meal',
          providerName: 'Saved meal',
          dataQuality: 'complete',
          warnings: [],
        }}
        detail={suggestion.timesLogged > 0 ? `logged ${suggestion.timesLogged}×` : 'saved locally'}
        onSelect={() => selectUsual(suggestion)}
      />
    );
  }

  function nutritionFields(
    values: typeof EMPTY_NUMBERS,
    setValues: (values: typeof EMPTY_NUMBERS) => void,
  ) {
    const fields: Array<{ key: keyof typeof EMPTY_NUMBERS; label: string; suffix: string; required?: boolean }> = [
      { key: 'calories', label: 'Calories', suffix: 'kcal', required: true },
      { key: 'proteinG', label: 'Protein', suffix: 'g' },
      { key: 'carbsG', label: 'Carbs', suffix: 'g' },
      { key: 'fatG', label: 'Fat', suffix: 'g' },
      { key: 'fiberG', label: 'Fiber', suffix: 'g' },
      { key: 'sugarG', label: 'Sugar', suffix: 'g' },
      { key: 'saturatedFatG', label: 'Saturated fat', suffix: 'g' },
      { key: 'sodiumMg', label: 'Sodium', suffix: 'mg' },
    ];
    return fields.map((field) => (
      <label className="field" key={field.key}>
        <span className="field__label">{field.label}{field.required ? '' : ' (optional)'}</span>
        <span className="input-shell">
          <input
            className="input"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            required={field.required}
            value={values[field.key]}
            onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
          />
          <span className="input-affix">{field.suffix}</span>
        </span>
      </label>
    ));
  }

  const sheetTitle = selection ? 'Choose the amount' : 'Add food';
  const sheetDescription = selection
    ? `Log ${selectedName ?? 'this food'} without changing its saved nutrition.`
    : 'Fare checks your own history first. Online food data is fetched only when you ask.';

  return (
    <>
      <BottomSheet
        open={open}
        onClose={closeSheet}
        title={sheetTitle}
        description={sheetDescription}
        width="large"
        className="add-food-sheet"
      >
        {selection && selectedServing && selectedNutrition && selectedProvenance ? (
          <div style={stack}>
            <button type="button" className="text-button" style={{ justifySelf: 'start' }} onClick={() => {
              setSelection(undefined);
              setError(undefined);
            }}>
              <ArrowLeft size={16} /> Back to foods
            </button>

            <Panel variant="outline" padding="default" style={stack}>
              <div>
                <h3 style={{ margin: 0, color: 'var(--text-strong)', fontSize: 20 }}>{selectedName}</h3>
                <p style={{ ...muted, marginTop: 3 }}>
                  {[selectedBrand, selectedServing.label].filter(Boolean).join(' · ')}
                </p>
              </div>
              <NutritionLine nutrition={scaleNutrition(selectedNutrition, servingCount)} />
              <div className="field">
                <span className="field__label">Servings</span>
                <div style={{ display: 'grid', gridTemplateColumns: '44px minmax(90px, 1fr) 44px', gap: 8 }}>
                  <button
                    type="button"
                    className="icon-button icon-button--soft"
                    aria-label="Decrease servings"
                    onClick={() => setServings(String(Math.max(0.25, servingCount - 0.25)))}
                  ><Minus /></button>
                  <input
                    className="input"
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.25"
                    value={servings}
                    onChange={(event) => setServings(event.target.value)}
                    aria-label="Number of servings"
                  />
                  <button
                    type="button"
                    className="icon-button icon-button--soft"
                    aria-label="Increase servings"
                    onClick={() => setServings(String(servingCount + 0.25))}
                  ><Plus /></button>
                </div>
                <div className="suggestion-strip" aria-label="Common serving amounts">
                  {[0.5, 1, 1.5, 2].map((amount) => (
                    <button type="button" className="suggestion-chip" key={amount} onClick={() => setServings(String(amount))}>
                      {amount}×
                    </button>
                  ))}
                </div>
              </div>
              <label className="field">
                <span className="field__label">Note <span className="field__optional">optional</span></span>
                <input className="input" value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. after workout" />
              </label>
            </Panel>

            <ProvenanceNote provenance={selectedProvenance} />
            {selection.kind === 'api' ? (
              <p style={muted}>
                Product data is provided by Open Food Facts under its database terms. Fare saves this exact nutrition version before logging it.
              </p>
            ) : null}
            {error ? <div className="notice notice--danger" role="alert"><AlertTriangle size={17} /> {error}</div> : null}
            <button type="button" className="button button--primary button--large button--full" onClick={confirmFood}>
              Add {formatAmount(scaleNutrition(selectedNutrition, servingCount).calories)} kcal to {mealSlot}
            </button>
          </div>
        ) : (
          <div style={stack}>
            <div style={compactStack}>
              <span className="field__label">Add to</span>
              <SegmentedControl
                value={mealSlot}
                options={MEAL_SLOTS}
                onChange={setMealSlot}
                label="Meal slot"
                fullWidth
                size="small"
              />
            </div>

            <SegmentedControl
              value={lane}
              options={LANES}
              onChange={(next) => {
                setLane(next);
                setError(undefined);
              }}
              label="Add food method"
              className="add-food-sheet__tabs"
            />

            {error ? <div className="notice notice--danger" role="alert"><AlertTriangle size={17} /> {error}</div> : null}
            {loading === 'barcode' ? (
              <div className="notice" role="status"><LoaderCircle className="spin" size={17} /> Looking up barcode…</div>
            ) : null}

            {lane === 'usuals' ? (
              <div className="add-food-sheet__results">
                <div style={{ ...row, marginBottom: 6 }}>
                  <div>
                    <strong style={{ color: 'var(--text-strong)' }}>Likely right now</strong>
                    <p style={muted}><Clock3 size={13} style={{ display: 'inline', verticalAlign: -2 }} /> Based on this meal, weekday, time, and your history.</p>
                  </div>
                </div>
                {localUsuals.length > 0 ? localUsuals.map(renderSuggestion) : (
                  <EmptyState
                    compact
                    icon={<Sparkles />}
                    title="Your Usuals will learn quickly"
                    description="Log a few foods and Fare will surface what you normally choose around this time."
                    action={<button type="button" className="button button--secondary button--small" onClick={() => setLane('search')}>Find a food</button>}
                  />
                )}
              </div>
            ) : null}

            {lane === 'search' ? (
              <div style={stack}>
                <form onSubmit={searchDatabase} style={compactStack}>
                  <div className="input-shell">
                    <Search aria-hidden="true" />
                    <input
                      className="input"
                      value={query}
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setError(undefined);
                      }}
                      placeholder="Search your foods, meals, or a product"
                      autoComplete="off"
                      autoFocus
                    />
                  </div>
                  <div style={row}>
                    <button type="button" className="button button--secondary button--small" onClick={() => setScannerOpen(true)}>
                      <ScanBarcode size={17} /> Scan barcode
                    </button>
                    <button type="submit" className="button button--outline button--small" disabled={loading === 'search' || query.trim().length < 2}>
                      {loading === 'search' ? <LoaderCircle className="spin" size={17} /> : <Database size={17} />}
                      Search Open Food Facts
                    </button>
                  </div>
                  <p style={muted}>Typing searches this device only. Open Food Facts is contacted only when you press its search button.</p>
                </form>

                {query.trim() ? (
                  <section>
                    <div style={row}>
                      <strong style={{ color: 'var(--text-strong)' }}>On this device</strong>
                      <SourceBadge source="history" label="Private + instant" />
                    </div>
                    {localResults.length > 0 ? localResults.map(renderSuggestion) : (
                      <p style={{ ...muted, padding: '14px 0' }}>No local matches yet. Use the explicit database search or create this food.</p>
                    )}
                  </section>
                ) : (
                  <EmptyState compact icon={<PackageSearch />} title="Start with your own library" description="Names, brands, aliases, saved meals, and prior choices are searched locally as you type." />
                )}

                {apiQuery ? (
                  <section>
                    <div style={{ ...row, marginBottom: 5 }}>
                      <strong style={{ color: 'var(--text-strong)' }}>Open Food Facts · “{apiQuery}”</strong>
                      <SourceBadge source="database" label={`${apiProducts.length} results`} />
                    </div>
                    {apiProducts.map((product) => (
                      <FoodResult
                        key={product.barcode}
                        name={product.name}
                        brand={product.brand}
                        servingLabel={product.serving.label}
                        nutrition={product.nutritionPerServing}
                        provenance={product.provenance}
                        detail={product.nutriScore ? `Nutri-Score ${product.nutriScore}` : undefined}
                        onSelect={() => beginProduct(product)}
                      />
                    ))}
                    <p style={{ ...muted, marginTop: 12 }}>Community-contributed data from Open Food Facts. Compare nutrition with the package label.</p>
                  </section>
                ) : null}
              </div>
            ) : null}

            {lane === 'quick' ? (
              <form style={stack} onSubmit={submitQuickAdd}>
                <Panel variant="soft" padding="compact">
                  <p style={muted}>For a known calorie or macro total you do not need to save as a reusable food.</p>
                </Panel>
                <label className="field">
                  <span className="field__label">Label <span className="field__optional">optional</span></span>
                  <input className="input" value={quickName} onChange={(event) => setQuickName(event.target.value)} placeholder="Quick add" />
                </label>
                <div className="form-grid">{nutritionFields(quickFields, setQuickFields)}</div>
                <button type="submit" className="button button--primary button--large button--full">Add to {mealSlot}</button>
              </form>
            ) : null}

            {lane === 'custom' ? (
              <form style={stack} onSubmit={submitCustomFood}>
                <Panel variant="soft" padding="compact">
                  <p style={muted}>Custom foods remain private, become searchable, and can be reused without retyping nutrition.</p>
                </Panel>
                <div className="form-grid">
                  <label className="field">
                    <span className="field__label">Food name</span>
                    <input className="input" required value={customName} onChange={(event) => setCustomName(event.target.value)} placeholder="Cafe latte protein shake" />
                  </label>
                  <label className="field">
                    <span className="field__label">Brand <span className="field__optional">optional</span></span>
                    <input className="input" value={customBrand} onChange={(event) => setCustomBrand(event.target.value)} placeholder="Premier Protein" />
                  </label>
                  <label className="field">
                    <span className="field__label">Serving amount</span>
                    <input className="input" type="number" inputMode="decimal" min="0.01" step="any" required value={servingQuantity} onChange={(event) => setServingQuantity(event.target.value)} />
                  </label>
                  <label className="field">
                    <span className="field__label">Serving unit</span>
                    <input className="input" required value={servingUnit} onChange={(event) => setServingUnit(event.target.value)} placeholder="bottle" />
                  </label>
                  <label className="field form-grid__full">
                    <span className="field__label">Serving label</span>
                    <input className="input" required value={servingLabel} onChange={(event) => setServingLabel(event.target.value)} placeholder="1 bottle (325 mL)" />
                  </label>
                </div>
                <div className="form-grid">{nutritionFields(customFields, setCustomFields)}</div>
                <button type="submit" className="button button--primary button--large button--full">Save food and choose amount</button>
              </form>
            ) : null}

            {lane === 'meals' ? (
              <div className="add-food-sheet__results">
                <div style={{ ...row, marginBottom: 5 }}>
                  <div>
                    <strong style={{ color: 'var(--text-strong)' }}>Saved meals</strong>
                    <p style={muted}>Logs each food as its own immutable entry.</p>
                  </div>
                  <SourceBadge source="history" label={`${savedMeals.length} saved`} />
                </div>
                {savedMeals.length > 0 ? savedMeals.map((meal) => (
                  <FoodResult
                    key={meal.id}
                    name={meal.name}
                    servingLabel={`${meal.items.length} foods`}
                    nutrition={mealNutrition(meal)}
                    provenance={{ kind: 'saved-meal', providerName: 'Saved meal', dataQuality: 'complete', warnings: [] }}
                    detail={meal.defaultSlot ? `usually ${meal.defaultSlot}` : undefined}
                    onSelect={() => logMeal(meal)}
                  />
                )) : (
                  <EmptyState compact icon={<UtensilsCrossed />} title="No saved meals yet" description="Combine foods you eat together and they will appear here for one-tap logging." />
                )}
              </div>
            ) : null}
          </div>
        )}
      </BottomSheet>

      <BarcodeScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={lookupBarcode}
      />
    </>
  );
}
