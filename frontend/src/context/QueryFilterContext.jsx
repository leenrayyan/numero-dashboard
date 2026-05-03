import { createContext, useContext, useState, useCallback } from "react";

const GlobalFilterContext = createContext(null);

// Categorical filters are always arrays (empty = no filter). Range filters
// stay as numeric mins/maxes since they're mutually-exclusive buckets.
const EMPTY = {
  segment:      [],
  productType:  [],
  country:      [],
  platform:     [],
  language:     [],
  recencyMin:   null,
  recencyMax:   null,
  spendMin:     null,
  spendMax:     null,
  ageMin:       null,
  ageMax:       null,
  nlUserIds:    null,
  nlQuestion:   null,
  nlSummary:    null,
  waReachable:  false,
  lassoUserIds: null,
};

// Coerce any setter input — array, single string, or null — into an array.
// Lets older callers that pass a single string keep working.
const toArray = (v) => Array.isArray(v) ? v : (v ? [v] : []);

export function QueryFilterProvider({ children }) {
  const [filters, setFilters] = useState(EMPTY);

  const setSegment     = useCallback((v) => setFilters(f => ({ ...f, segment:     toArray(v) })), []);
  const setProductType = useCallback((v) => setFilters(f => ({ ...f, productType: toArray(v) })), []);
  const setCountry     = useCallback((v) => setFilters(f => ({ ...f, country:     toArray(v) })), []);
  const setPlatform    = useCallback((v) => setFilters(f => ({ ...f, platform:    toArray(v) })), []);
  const setLanguage    = useCallback((v) => setFilters(f => ({ ...f, language:    toArray(v) })), []);

  const setRecency     = useCallback((min, max) => setFilters(f => ({ ...f, recencyMin: min ?? null, recencyMax: max ?? null })), []);
  const setSpend       = useCallback((min, max) => setFilters(f => ({ ...f, spendMin:   min ?? null, spendMax:   max ?? null })), []);
  const setAge         = useCallback((min, max) => setFilters(f => ({ ...f, ageMin:     min ?? null, ageMax:     max ?? null })), []);

  const setWaReachable = useCallback((val) => setFilters(f => ({ ...f, waReachable: !!val })), []);
  const setLasso       = useCallback((ids) => setFilters(f => ({ ...f, lassoUserIds: ids?.length ? ids : null })), []);
  const clearLasso     = useCallback(() => setFilters(f => ({ ...f, lassoUserIds: null })), []);
  const setNLFilter    = useCallback(({ userIds, question, summary }) =>
    setFilters(f => ({ ...f, nlUserIds: userIds || null, nlQuestion: question, nlSummary: summary })), []);
  const clearNL        = useCallback(() => setFilters(f => ({ ...f, nlUserIds: null, nlQuestion: null, nlSummary: null })), []);
  const clearAll       = useCallback(() => setFilters(EMPTY), []);

  const activeUserIds = (() => {
    const nl    = filters.nlUserIds;
    const lasso = filters.lassoUserIds;
    if (nl && lasso) {
      const lassoSet = new Set(lasso.map(String));
      return nl.filter(id => lassoSet.has(String(id)));
    }
    return nl || lasso || null;
  })();

  const userIdsStr = activeUserIds?.length
    ? activeUserIds.slice(0, 5000).join(",")
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
    ...(userIdsStr                      && { user_ids:      userIdsStr }),
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
    filters.nlUserIds || filters.lassoUserIds || filters.waReachable
  );

  const selectedUserCount = activeUserIds?.length ?? null;

  return (
    <GlobalFilterContext.Provider value={{
      filters, apiParams, userApiParams, hasActiveFilter, selectedUserCount,
      setSegment, setRecency, setCountry, setProductType, setSpend,
      setAge, setPlatform, setLanguage, setWaReachable,
      setLasso, clearLasso, setNLFilter, clearNL, clearAll,
      activeFilter: filters.nlQuestion
        ? { question: filters.nlQuestion, summary: filters.nlSummary, userIds: filters.nlUserIds }
        : null,
      applyFilter: ({ question, summary, userIds }) => setNLFilter({ userIds, question, summary }),
      clearFilter: clearNL,
    }}>
      {children}
    </GlobalFilterContext.Provider>
  );
}

export function useQueryFilter() { return useContext(GlobalFilterContext); }
export const useGlobalFilter = useQueryFilter;
