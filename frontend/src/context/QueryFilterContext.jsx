import { createContext, useContext, useState, useCallback, startTransition } from "react";

const GlobalFilterContext = createContext(null);

// Categorical filters are always arrays (empty = no filter). Range filters
// stay as numeric mins/maxes since they're mutually-exclusive buckets.
//
// NL filters use a server-side audience token (nlAudienceId): when Smart Query
// returns a user list, the backend stashes the full id list under an opaque
// token and we send ?audience=<token> to analytics endpoints. nlAudienceSize
// is the full count from the server, used for "X users matched" display.
// lassoUserIds stays as an explicit id list because lasso selections are
// bounded (<5000 visible scatter points) and need to round-trip the picks.
const EMPTY = {
  segment:        [],
  productType:    [],
  country:        [],
  platform:       [],
  language:       [],
  recencyMin:     null,
  recencyMax:     null,
  spendMin:       null,
  spendMax:       null,
  ageMin:         null,
  ageMax:         null,
  nlAudienceId:   null,
  nlAudienceSize: 0,
  nlQuestion:     null,
  nlSummary:      null,
  nlSql:          null,
  waReachable:    false,
  lassoUserIds:   null,
};

// Coerce any setter input — array, single string, or null — into an array.
// Lets older callers that pass a single string keep working.
const toArray = (v) => Array.isArray(v) ? v : (v ? [v] : []);

// Segment names are product-prefixed in the seed (e.g. "Calls - Regular
// Calling Offer Users", "Virtual - Light Occasional Users"). The product-prefix is
// the source of truth for which product the segment belongs to — segments are
// disjoint across products. Used by setSegment to auto-sync productType so
// picking a Virtual segment while filtered to Calls doesn't intersect to zero.
const PRODUCT_FROM_PREFIX = {
  "Calls":   "Calls",
  "eSIM":    "Data eSIM",
  "Virtual": "Virtual Number",
};
function productFromSegment(seg) {
  if (typeof seg !== "string") return null;
  const prefix = seg.split(" - ", 1)[0];
  return PRODUCT_FROM_PREFIX[prefix] ?? null;
}

export function QueryFilterProvider({ children }) {
  const [filters, setFilters] = useState(EMPTY);

  // Filter changes that trigger heavy downstream re-fetches (segment, product)
  // are wrapped in `startTransition`. React then treats them as non-urgent:
  //   - the previous UI stays visible and interactive during the update
  //   - intermediate loading states don't flash
  //   - the final layout swap happens once everything is ready
  // Combined with CSS scroll anchoring (set in index.css), this prevents
  // the page from scroll-jumping when filters change above-the-fold panels.

  // setSegment also auto-syncs productType so segment + product can't fight.
  // Rules:
  //   - 0 segments: leave productType as the user set it.
  //   - All chosen segments belong to the SAME product → set productType to it
  //     (replaces whatever was there — picking a "Virtual - X" segment while
  //     filtered to Calls swaps the product over).
  //   - Mixed-product segments → clear productType (no single product covers
  //     all the chosen segments).
  // Trade-off: if a user manually set productType=Calls and then picks a
  // Virtual segment, the Calls filter is dropped. That matches the screen
  // behaviour the user wants: the latest segment click "wins" and reshapes
  // the product context.
  const setSegment = useCallback((v) => {
    const segs = toArray(v);
    startTransition(() => {
      setFilters(f => {
        const products = [...new Set(segs.map(productFromSegment).filter(Boolean))];
        let nextProductType = f.productType;
        if (segs.length === 0) {
          // no change to productType
        } else if (products.length === 1) {
          nextProductType = products;
        } else {
          nextProductType = [];
        }
        return { ...f, segment: segs, productType: nextProductType };
      });
    });
  }, []);
  const setProductType = useCallback((v) => {
    startTransition(() => {
      setFilters(f => ({ ...f, productType: toArray(v) }));
    });
  }, []);
  const setCountry     = useCallback((v) => setFilters(f => ({ ...f, country:     toArray(v) })), []);
  const setPlatform    = useCallback((v) => setFilters(f => ({ ...f, platform:    toArray(v) })), []);
  const setLanguage    = useCallback((v) => setFilters(f => ({ ...f, language:    toArray(v) })), []);

  const setRecency     = useCallback((min, max) => setFilters(f => ({ ...f, recencyMin: min ?? null, recencyMax: max ?? null })), []);
  const setSpend       = useCallback((min, max) => setFilters(f => ({ ...f, spendMin:   min ?? null, spendMax:   max ?? null })), []);
  const setAge         = useCallback((min, max) => setFilters(f => ({ ...f, ageMin:     min ?? null, ageMax:     max ?? null })), []);

  const setWaReachable = useCallback((val) => setFilters(f => ({ ...f, waReachable: !!val })), []);
  const setLasso       = useCallback((ids) => setFilters(f => ({ ...f, lassoUserIds: ids?.length ? ids : null })), []);
  const clearLasso     = useCallback(() => setFilters(f => ({ ...f, lassoUserIds: null })), []);
  const setNLFilter    = useCallback(({ audienceId, audienceSize, question, summary, sql }) =>
    setFilters(f => ({
      ...f,
      nlAudienceId:   audienceId   || null,
      nlAudienceSize: audienceSize || 0,
      nlQuestion:     question     || null,
      nlSummary:      summary      || null,
      nlSql:          sql          || null,
    })), []);
  const clearNL        = useCallback(() => setFilters(f => ({
    ...f, nlAudienceId: null, nlAudienceSize: 0, nlQuestion: null, nlSummary: null, nlSql: null,
  })), []);
  const clearAll       = useCallback(() => setFilters(EMPTY), []);

  // Lasso is a small (<5000) explicit id list — passed as ?user_ids=...
  // NL filter is a server-side audience token — passed as ?audience=...
  // The backend intersects them when both are present.
  const lassoIdsStr = filters.lassoUserIds?.length
    ? filters.lassoUserIds.slice(0, 5000).join(",")
    : undefined;

  // All categorical filters serialise as comma-joined strings; backend
  // build_where parses these as IN (...) clauses.
  const apiParams = {
    ...(filters.segment?.length     > 0 && { segment:       filters.segment.join(",") }),
    ...(filters.productType?.length > 0 && { product_group: filters.productType.join(",") }),
    ...(filters.country?.length     > 0 && { country:       filters.country.join(",") }),
    ...(filters.platform?.length    > 0 && { platform:      filters.platform.join(",") }),
    ...(filters.language?.length    > 0 && { language:      filters.language.join(",") }),
    ...(filters.recencyMin != null      && { min_recency:   filters.recencyMin }),
    ...(filters.recencyMax != null      && { max_recency:   filters.recencyMax }),
    ...(filters.spendMin   != null      && { spend_min:     filters.spendMin }),
    ...(filters.spendMax   != null      && { spend_max:     filters.spendMax }),
    ...(filters.ageMin     != null      && { min_age:       filters.ageMin }),
    ...(filters.ageMax     != null      && { max_age:       filters.ageMax }),
    ...(filters.waReachable             && { wa_reachable:  true }),
    ...(filters.nlAudienceId            && { audience:      filters.nlAudienceId }),
    ...(lassoIdsStr                     && { user_ids:      lassoIdsStr }),
  };

  const userApiParams = apiParams;

  const hasActiveFilter = !!(
    filters.segment?.length     > 0 ||
    filters.productType?.length > 0 ||
    filters.country?.length     > 0 ||
    filters.platform?.length    > 0 ||
    filters.language?.length    > 0 ||
    filters.recencyMin != null ||
    filters.spendMin   != null ||
    filters.ageMin     != null ||
    filters.nlAudienceId || filters.lassoUserIds || filters.waReachable
  );

  // For "X users selected" display. NL audience size comes from server (full
  // count); lasso is whatever the user lassoed. When both, we show NL size as
  // an upper bound (the backend will intersect).
  const selectedUserCount = filters.nlAudienceId
    ? filters.nlAudienceSize
    : (filters.lassoUserIds?.length ?? null);

  return (
    <GlobalFilterContext.Provider value={{
      filters, apiParams, userApiParams, hasActiveFilter, selectedUserCount,
      setSegment, setRecency, setCountry, setProductType, setSpend,
      setAge, setPlatform, setLanguage, setWaReachable,
      setLasso, clearLasso, setNLFilter, clearNL, clearAll,
      activeFilter: filters.nlQuestion
        ? {
            question:     filters.nlQuestion,
            summary:      filters.nlSummary,
            sql:          filters.nlSql,
            audienceId:   filters.nlAudienceId,
            audienceSize: filters.nlAudienceSize,
          }
        : null,
      applyFilter: ({ question, summary, sql, audienceId, audienceSize }) =>
        setNLFilter({ audienceId, audienceSize, question, summary, sql }),
      clearFilter: clearNL,
    }}>
      {children}
    </GlobalFilterContext.Provider>
  );
}

export function useQueryFilter() { return useContext(GlobalFilterContext); }
export const useGlobalFilter = useQueryFilter;
