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

// Cohesive segment palette — cool brand spectrum (blues/purples/rose) with
// sage green + cool coral as semantic accents. The 9 new cluster names follow
// the `<Product> - <Tier>` convention; we colour-code by tier semantics, not
// by product, so loyal-at-risk is always rose-ish whether it's Calls or eSIM.
export const SEGMENT_COLORS = {
  // Calls
  "Calls - High Value Loyal (At Risk)":      "#B0456E", // brand rose (high-value but slipping)
  "Calls - Low Value Active":                "#4A90C8", // light blue (active)
  "Calls - Frequent Low Spenders (Cooling)": "#8A5DB5", // mid purple (frequent but cooling)

  // eSIM
  "eSIM - High Value Users (At Risk)":       "#C56988", // soft rose (warning)
  "eSIM - Low Value Inactive":               "#7050B5", // light purple (inactive)
  "eSIM - Mid Value Active":                 "#4FA88C", // sage green (healthy)

  // Virtual
  "Virtual - High Value Loyal (At Risk)":    "#5B3A9E", // brand purple (premium / at risk)
  "Virtual - Mid Value Inactive":            "#D8896B", // cool coral (mid / cooling)
  "Virtual - Low Value Active":              "#2A7FB8", // brand blue (active)
};

export const PRODUCT_COLORS = {
  "Calls":          "#2A7FB8",
  "Data eSIM":      "#5B3A9E",
  "Virtual Number": "#B0456E",
};

export const PALETTE = [
  "#5B3A9E", "#2A7FB8", "#4FA88C", "#D8896B",
  "#B0456E", "#8A5DB5", "#4A90C8", "#C56988",
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
