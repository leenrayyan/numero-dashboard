// Numero-brand palette — derived from the logo's blue → purple → rose gradient.
// Cohesive cool spectrum (azure → indigo → purple → rose) with the rose reserved
// as the single warm accent. Lower saturation than the previous palette so charts
// don't fight each other for attention.

export const BRAND = {
  blue:   "#2A7FB8", // logo bottom-left azure
  purple: "#5B3A9E", // logo middle deep purple
  rose:   "#B0456E", // logo top-right crimson, slightly muted
  green:  "#4FA88C", // pastel sage — accent for positive/loyal/revenue
  coral:  "#D8896B", // cool coral — accent for fresh/new/welcoming
};

export const KPI = {
  purple: "#5B3A9E", // primary brand — Dormant Users
  blue:   "#2A7FB8", // brand blue
  rose:   "#B0456E", // accent rose — Avg Inactivity (warning hue)
  indigo: "#4055A8", // transitional — Avg Spend / LTV
  green:  "#4FA88C", // pastel green — Total Revenue (money)
  coral:  "#D8896B", // cool coral
  // Aliases — kept so legacy references (KPI.pink, KPI.teal) still resolve.
  pink:   "#B0456E", // → rose
  teal:   "#4FA88C", // → green
};

// Subtle gradients for KPI cards — top→bottom, ~10% darker at the bottom.
export const KPI_GRADIENTS = {
  purple: "linear-gradient(160deg, #6B47B0 0%, #4A2D85 100%)",
  blue:   "linear-gradient(160deg, #3590C8 0%, #1F6AA0 100%)",
  rose:   "linear-gradient(160deg, #C2557D 0%, #963D5F 100%)",
  indigo: "linear-gradient(160deg, #5165BA 0%, #344798 100%)",
  green:  "linear-gradient(160deg, #5DB89C 0%, #3D8E74 100%)",
  coral:  "linear-gradient(160deg, #E29478 0%, #B86E50 100%)",
};

// 12-segment palette across Calls / eSIM / Virtual. Picked to maximise pairwise
// hue distinctness so adjacent legend pills read as separate colours, not
// gradients of the same one. Kept in sync with
// backend/routers/segmentation.py SEGMENT_COLORS.
export const SEGMENT_COLORS = {
  // Calls (4)
  "Calls - High-Value Power Users":                          "#B0456E", // brand rose
  "Calls - Active Offer-Driven Customers":                   "#D8896B", // coral
  "Calls - At-Risk Customers":                               "#E8B945", // mustard amber (warning-tier)
  "Calls - One-Time Customers":                              "#A0A0A0", // neutral grey

  // eSIM (3)
  "eSIM - High-Value Global Power Users":                    "#2A7FB8", // brand blue
  "eSIM - Local Data Users":                                 "#3D9DB0", // turquoise
  "eSIM - Data-Only Minimal Users":                          "#6B7CC8", // periwinkle

  // Virtual (5)
  "Virtual - High-Value Power Users":                        "#5B3A9E", // brand deep purple
  "Virtual - Loyal Infrequent Buyers":                       "#4FA88C", // brand sage green
  "Virtual - Churned Low-Value Users":                       "#9B5DB8", // plum
  "Virtual - Low-Value Single-Product Users (Local Plan)":   "#C8825A", // burnt orange
  "Virtual - EU Bundle Focused Customers":                   "#DA5C8E", // bright magenta
};

export const PRODUCT_COLORS = {
  "Calls":          "#2A7FB8",
  "Data eSIM":      "#5B3A9E",
  "Virtual Number": "#B0456E",
};

// Generic categorical palette — used as the fallback colour ramp when a
// dimension (Product Type, Platform, Language…) doesn't have a fixed mapping.
// Order is tuned so consecutive picks are always visually distinct.
export const PALETTE = [
  "#5B3A9E", // deep purple
  "#4FA88C", // sage green
  "#B0456E", // brand rose
  "#2A7FB8", // azure blue
  "#D8896B", // cool coral
  "#3D9DB0", // turquoise
  "#9B5DB8", // plum
  "#C8825A", // burnt orange
  "#6B7CC8", // periwinkle
];

// Reactivation funnel — blue → purple → rose progression matching the logo.
// Conversion lands on the brand rose to highlight the goal stage.
export const FUNNEL_COLORS = {
  targeted:  "#C8DAEC",
  sent:      "#8AB4D8",
  delivered: "#5B7FCE",
  read:      "#5B3A9E",
  replied:   "#8A5DB5",
  converted: "#B0456E",
};
