import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:8000",
});

// All analytics + segmentation endpoints accept the same filter params:
// { segment, min_recency, max_recency }
// Pass them via the `fp` (filterParams) argument on every call.

export const analytics = {
  overview:      (fp) => api.get("/api/analytics/overview",       { params: fp }),
  activityTrend: (fp) => api.get("/api/analytics/activity-trend", { params: fp }),
  segmentTrend:  (fp) => api.get("/api/analytics/segment-trend",  { params: fp }),
  dormantWeekly: (fp) => api.get("/api/analytics/dormant-weekly", { params: fp }),
  segmentSummary:(fp) => api.get("/api/analytics/segment-summary",{ params: fp }),
  reactivationDist: (fp) => api.get("/api/analytics/reactivation-distribution", { params: fp }),
  audienceBreakdown: (fp) => api.get("/api/analytics/audience-breakdown", { params: fp }),
  // Percentile cutoffs (HIGH ≥ p80, MEDIUM ≥ p50) of the current
  // `users.reactivation_score` distribution. Used by ReactivationBadge to
  // colour the user-table chip without hardcoding fixed thresholds (which
  // empty out when a model doesn't reach absolute probabilities like 0.7).
  reactivationCutoffs: () => api.get("/api/analytics/reactivation-cutoffs"),
};

export const users = {
  list:      (params) => api.get("/api/users/",          { params }),
  ids:       (params) => api.get("/api/users/ids",       { params }),
  get:       (id)     => api.get(`/api/users/${id}`),
  countries: ()       => api.get("/api/users/countries"),
  platforms: ()       => api.get("/api/users/platforms"),
  languages: ()       => api.get("/api/users/languages"),
};

export const segmentation = {
  overview: (fp) => api.get("/api/segmentation/",                    { params: fp }),
  revenue:  (fp) => api.get("/api/segmentation/revenue-by-segment",  { params: fp }),
};

export const clusters = {
  list:  (params)      => api.get("/api/clusters/",       { params }),
  // Lookup by segment NAME (e.g. "Calls - Regular Calling Offer Users") — cluster
  // IDs aren't unique across products and the old `/clusters/{id}/users`
  // endpoint silently returned mixed-product users. Segment names are unique.
  usersBySegment: (segmentName, params) =>
    api.get(`/api/clusters/by-segment/${encodeURIComponent(segmentName)}/users`, { params }),
  // PCA coords are pre-computed per product in the seed (one PCA fit per
  // product group). Endpoint returns { mode, panels: [{ product, points }] }
  // — single panel when one product is selected, three panels otherwise.
  pca:   (params)      => api.get("/api/clusters/pca", { params }),
};

export const query = {
  ask:      (question)         => api.post("/api/query/", { question }),
  feedback: (payload)          => api.post("/api/query/feedback", payload),
};

export const campaigns = {
  list:         (params) => api.get("/api/campaigns/", { params }),
  funnel:       ()       => api.get("/api/campaigns/funnel-summary"),
  create:       (data)   => api.post("/api/campaigns/", data),
  get:          (id)     => api.get(`/api/campaigns/${id}`),
  updateStatus: (id, status) => api.put(`/api/campaigns/${id}/status`, null, { params: { status } }),
  updateStats:  (id, data)   => api.patch(`/api/campaigns/${id}/stats`, null, { params: data }),
};

/** CSV exports — these return file downloads, so use window.open() or an <a> tag */
export const exports = {
  usersUrl:    (params) => {
    const qs = new URLSearchParams(Object.entries(params || {}).filter(([,v]) => v != null)).toString();
    return `${api.defaults.baseURL}/api/exports/users${qs ? '?' + qs : ''}`;
  },
  segmentsUrl: (params) => {
    const qs = new URLSearchParams(Object.entries(params || {}).filter(([,v]) => v != null)).toString();
    return `${api.defaults.baseURL}/api/exports/segments${qs ? '?' + qs : ''}`;
  },
  campaignsUrl: () => `${api.defaults.baseURL}/api/exports/campaigns`,
};

export default api;
