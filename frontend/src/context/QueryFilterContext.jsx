import { createContext, useContext, useState, useCallback } from "react";

const GlobalFilterContext = createContext(null);

const EMPTY = {
  segment:      null,
  recencyMin:   null,
  recencyMax:   null,
  nlUserIds:    null,
  nlQuestion:   null,
  nlSummary:    null,
  country:      null,
  productType:  null,
  spendMin:     null,
  spendMax:     null,
  ageMin:       null,
  ageMax:       null,
  platform:     null,
  language:     null,
  waReachable:  false,
  lassoUserIds: null,
};

export function QueryFilterProvider({ children }) {
  const [filters, setFilters] = useState(EMPTY);

  const setSegment     = useCallback((seg) => setFilters(f => ({ ...f, segment: seg || null })), []);
  const setRecency     = useCallback((min, max) => setFilters(f => ({ ...f, recencyMin: min ?? null, recencyMax: max ?? null })), []);
  const setCountry     = useCallback((c) => setFilters(f => ({ ...f, country: c || null })), []);
  const setProductType = useCallback((pt) => setFilters(f => ({ ...f, productType: pt || null })), []);
  const setSpend       = useCallback((min, max) => setFilters(f => ({ ...f, spendMin: min ?? null, spendMax: max ?? null })), []);
  const setAge         = useCallback((min, max) => setFilters(f => ({ ...f, ageMin: min ?? null, ageMax: max ?? null })), []);
  const setPlatform    = useCallback((p) => setFilters(f => ({ ...f, platform: p || null })), []);
  const setLanguage    = useCallback((l) => setFilters(f => ({ ...f, language: l || null })), []);
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

  const apiParams = {
    ...(filters.segment                && { segment:       filters.segment }),
    ...(filters.recencyMin  != null    && { min_recency:   filters.recencyMin }),
    ...(filters.recencyMax  != null    && { max_recency:   filters.recencyMax }),
    ...(filters.country                && { country:       filters.country }),
    ...(filters.productType            && { product_group: filters.productType }),
    ...(filters.spendMin    != null    && { spend_min:     filters.spendMin }),
    ...(filters.spendMax    != null    && { spend_max:     filters.spendMax }),
    ...(filters.ageMin      != null    && { min_age:       filters.ageMin }),
    ...(filters.ageMax      != null    && { max_age:       filters.ageMax }),
    ...(filters.platform               && { platform:      filters.platform }),
    ...(filters.language               && { language:      filters.language }),
    ...(filters.waReachable            && { wa_reachable:  true }),
    ...(userIdsStr                     && { user_ids:      userIdsStr }),
  };

  const userApiParams = apiParams;

  const hasActiveFilter = !!(
    filters.segment || filters.recencyMin != null ||
    filters.nlUserIds || filters.country ||
    filters.productType || filters.spendMin != null ||
    filters.ageMin != null || filters.platform || filters.language ||
    filters.waReachable || filters.lassoUserIds
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
