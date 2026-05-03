"""Customer-level feature engineering for the reactivation model.

All features are computed strictly from purchases with `purchase_date < cutoff`,
so there is no temporal leakage.

Two families of windowed features:
  - WINDOWS_FROM_CUTOFF: lookback from the cutoff date. For an inactive
    population (last purchase > N days before cutoff), windows shorter than N
    are zero by construction, so we use 90/180/365 only.
  - WINDOWS_BEFORE_LAST: lookback from the customer's *own* last purchase.
    Captures velocity at the moment of going silent — directly predictive of
    reactivation likelihood. Always non-trivial.
"""
import numpy as np
import pandas as pd

WINDOWS_FROM_CUTOFF = [90, 180, 365]
WINDOWS_BEFORE_LAST = [30, 90, 180]


def _safe_div(a, b):
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    return np.where(b > 0, a / np.where(b > 0, b, 1.0), 0.0)


def build_features(df: pd.DataFrame, cutoff, group: str) -> pd.DataFrame:
    """Customer-level feature matrix as of `cutoff` for one product group.

    Returns a dataframe indexed by `id_client` containing only customers with
    at least one pre-cutoff purchase in the group.
    """
    cutoff = pd.Timestamp(cutoff)
    g = df[(df['product_group'] == group) & (df['purchase_date'] < cutoff)].copy()
    if len(g) == 0:
        return pd.DataFrame()

    g['days_before_cutoff'] = (cutoff - g['purchase_date']).dt.days

    # Lifetime aggregates. Fill NaN price with 0 first so derived features
    # (avg_price, total_spent) are always finite even when raw price is missing.
    g['price'] = g['price'].fillna(0.0)
    feats = g.groupby('id_client').agg(
        n_purchases_lifetime=('purchase_date', 'size'),
        total_spent_lifetime=('price', 'sum'),
        avg_price_lifetime=('price', 'mean'),
        std_price_lifetime=('price', 'std'),
        first_purchase=('purchase_date', 'min'),
        last_purchase=('purchase_date', 'max'),
        n_distinct_product_types=('product_type', 'nunique'),
        n_distinct_details=('details', 'nunique'),
    )
    feats['std_price_lifetime'] = feats['std_price_lifetime'].fillna(0.0)
    feats['avg_price_lifetime'] = feats['avg_price_lifetime'].fillna(0.0)
    feats['days_since_last'] = (cutoff - feats['last_purchase']).dt.days
    feats['tenure_days'] = (cutoff - feats['first_purchase']).dt.days
    feats['active_span_days'] = (feats['last_purchase'] - feats['first_purchase']).dt.days
    feats['purchases_per_active_day'] = _safe_div(
        feats['n_purchases_lifetime'], feats['active_span_days'].clip(lower=1)
    )

    # Windowed counts / spend, lookback from cutoff
    for w in WINDOWS_FROM_CUTOFF:
        win = g[g['days_before_cutoff'] <= w]
        agg = win.groupby('id_client').agg(
            **{
                f'n_purchases_{w}d': ('purchase_date', 'size'),
                f'total_spent_{w}d': ('price', 'sum'),
            }
        )
        feats = feats.join(agg, how='left')
        feats[f'n_purchases_{w}d'] = feats[f'n_purchases_{w}d'].fillna(0).astype(int)
        feats[f'total_spent_{w}d'] = feats[f'total_spent_{w}d'].fillna(0.0)

    # Windowed counts / spend, lookback from each customer's own last purchase
    g_with_last = g.merge(
        feats[['days_since_last']].reset_index().rename(columns={'days_since_last': 'cust_days_since_last'}),
        on='id_client', how='left',
    )
    g_with_last['days_before_last'] = g_with_last['days_before_cutoff'] - g_with_last['cust_days_since_last']
    # days_before_last == 0 for the last purchase itself; positive integers for older
    for w in WINDOWS_BEFORE_LAST:
        win = g_with_last[g_with_last['days_before_last'] <= w]
        agg = win.groupby('id_client').agg(
            **{
                f'n_purchases_{w}d_before_last': ('purchase_date', 'size'),
                f'total_spent_{w}d_before_last': ('price', 'sum'),
            }
        )
        feats = feats.join(agg, how='left')
        feats[f'n_purchases_{w}d_before_last'] = feats[f'n_purchases_{w}d_before_last'].fillna(0).astype(int)
        feats[f'total_spent_{w}d_before_last'] = feats[f'total_spent_{w}d_before_last'].fillna(0.0)

    # Velocity ratios using the before-last windows (non-trivial by design)
    feats['ratio_purchases_30_180_before_last'] = _safe_div(
        feats['n_purchases_30d_before_last'], feats['n_purchases_180d_before_last']
    )
    feats['ratio_spend_30_180_before_last'] = _safe_div(
        feats['total_spent_30d_before_last'], feats['total_spent_180d_before_last']
    )
    feats['ratio_purchases_90_365_from_cutoff'] = _safe_div(
        feats['n_purchases_90d'], feats['n_purchases_365d']
    )
    feats['ratio_spend_90_365_from_cutoff'] = _safe_div(
        feats['total_spent_90d'], feats['total_spent_365d']
    )

    # Inter-purchase time statistics
    g_sorted = g.sort_values(['id_client', 'purchase_date'])
    g_sorted['ipt'] = g_sorted.groupby('id_client')['purchase_date'].diff().dt.days
    ipt = g_sorted.groupby('id_client')['ipt'].agg(
        mean_ipt='mean', std_ipt='std', max_ipt='max'
    )
    ipt['std_ipt'] = ipt['std_ipt'].fillna(0.0)
    ipt['cv_ipt'] = _safe_div(ipt['std_ipt'], ipt['mean_ipt'])
    feats = feats.join(ipt, how='left')
    # Customers with a single purchase have no IPT — sentinel value
    for col in ['mean_ipt', 'std_ipt', 'max_ipt', 'cv_ipt']:
        feats[col] = feats[col].fillna(-1.0)

    # Renewal share (non-'New' renewal_status)
    g['is_renewal'] = (g['renewal_status'].astype(str).str.lower() != 'new').astype(int)
    feats = feats.join(
        g.groupby('id_client')['is_renewal'].mean().rename('renewal_share'),
        how='left',
    )
    feats['renewal_share'] = feats['renewal_share'].fillna(0.0)

    # Categorical state — taken from the most recent pre-cutoff purchase
    most_recent = g.sort_values('purchase_date').groupby('id_client').tail(1).set_index('id_client')
    feats = feats.join(
        most_recent[['User Country', 'platform', 'language', 'product_type']]
            .rename(columns={
                'User Country': 'country',
                'product_type': 'dominant_product_type',
            }),
        how='left',
    )

    # Register-month seasonality
    register_month = (
        df[df['id_client'].isin(feats.index)]
        .groupby('id_client')['register_date'].min().dt.month.rename('register_month')
    )
    feats = feats.join(register_month, how='left')

    feats = feats.drop(columns=['first_purchase', 'last_purchase'])
    return feats


CATEGORICAL_COLUMNS = ['country', 'platform', 'language', 'dominant_product_type']


CROSS_WINDOWS = [30, 60, 90, 180, 365]


def build_cross_group_features(df: pd.DataFrame, cutoff, target_group: str) -> pd.DataFrame:
    """Customer-level features from groups OTHER than `target_group`.

    Captures the fact that the same id_client may be active in Virtual or eSIM
    while looking dead in Calls — a strong reactivation signal.
    Returns a dataframe indexed by id_client. All windows are non-trivial here
    because cross-group activity is independent of the target-group inactivity.
    """
    cutoff = pd.Timestamp(cutoff)
    other = df[(df['product_group'] != target_group) & (df['purchase_date'] < cutoff)].copy()
    if len(other) == 0:
        return pd.DataFrame()

    other['days_before_cutoff'] = (cutoff - other['purchase_date']).dt.days

    # Lifetime cross-group aggregates
    feats = other.groupby('id_client').agg(
        n_purchases_other_lifetime=('purchase_date', 'size'),
        total_spent_other_lifetime=('price', 'sum'),
        n_distinct_other_groups_lifetime=('product_group', 'nunique'),
    )
    last_other = other.groupby('id_client')['purchase_date'].max()
    feats['days_since_any_other_purchase'] = (cutoff - last_other).dt.days

    # Windowed cross-group activity
    for w in CROSS_WINDOWS:
        win = other[other['days_before_cutoff'] <= w]
        agg = win.groupby('id_client').agg(
            **{
                f'n_purchases_other_{w}d': ('purchase_date', 'size'),
                f'total_spent_other_{w}d': ('price', 'sum'),
                f'n_distinct_other_groups_{w}d': ('product_group', 'nunique'),
            }
        )
        feats = feats.join(agg, how='left')
        feats[f'n_purchases_other_{w}d'] = feats[f'n_purchases_other_{w}d'].fillna(0).astype(int)
        feats[f'total_spent_other_{w}d'] = feats[f'total_spent_other_{w}d'].fillna(0.0)
        feats[f'n_distinct_other_groups_{w}d'] = feats[f'n_distinct_other_groups_{w}d'].fillna(0).astype(int)

    # Convenience binary flags
    feats['is_active_other_60d'] = (feats['n_purchases_other_60d'] > 0).astype(int)
    feats['is_active_other_180d'] = (feats['n_purchases_other_180d'] > 0).astype(int)

    return feats


def compute_bgnbd_p_alive(df: pd.DataFrame, cutoff, group: str) -> pd.Series:
    """Fit a BG/NBD model on pre-cutoff transactions in the target group and
    return each customer's probability of being 'alive' at the cutoff.

    BG/NBD (Beta-Geometric / NBD) is the standard 'Buy Till You Die' model for
    non-contractual settings (Fader, Hardie & Lee 2005). Output is a calibrated
    P(customer will purchase again | history) — a strong feature for
    reactivation prediction, especially for episodic groups like Data eSIM.

    Returns a pandas Series indexed by id_client; NaN for customers with no
    pre-cutoff history.
    """
    from lifetimes import BetaGeoFitter
    from lifetimes.utils import summary_data_from_transaction_data

    cutoff = pd.Timestamp(cutoff)
    pre = df[(df['product_group'] == group) & (df['purchase_date'] < cutoff)]
    if len(pre) == 0:
        return pd.Series(name='p_alive', dtype=float)

    summary = summary_data_from_transaction_data(
        pre, 'id_client', 'purchase_date',
        observation_period_end=cutoff - pd.Timedelta(days=1),
        freq='D',
    )
    bgf = BetaGeoFitter(penalizer_coef=0.01)
    bgf.fit(summary['frequency'], summary['recency'], summary['T'])
    p_alive = bgf.conditional_probability_alive(
        summary['frequency'], summary['recency'], summary['T']
    )
    # Older lifetimes returns a Series, newer returns ndarray — handle both.
    p_alive_arr = p_alive.values if hasattr(p_alive, 'values') else np.asarray(p_alive)
    return pd.Series(p_alive_arr, index=summary.index, name='p_alive')


def build_full_feature_set(df: pd.DataFrame, cutoff, group: str,
                            include_bgnbd: bool = False) -> pd.DataFrame:
    """Combine within-group and cross-group features (and optionally BG/NBD).

    For customers with no other-group activity, cross-group features are 0 /
    sentinel (`days_since_any_other_purchase` = -1). When `include_bgnbd=True`,
    a `p_alive` feature is fit and joined.
    """
    within = build_features(df, cutoff, group)
    cross = build_cross_group_features(df, cutoff, group)
    feats = within.join(cross, how='left')
    # Fill missing cross-group features for customers active only in target group
    for col in cross.columns:
        if col == 'days_since_any_other_purchase':
            feats[col] = feats[col].fillna(-1.0)
        else:
            feats[col] = feats[col].fillna(0)

    if include_bgnbd:
        p_alive = compute_bgnbd_p_alive(df, cutoff, group)
        feats = feats.join(p_alive, how='left')
        feats['p_alive'] = feats['p_alive'].fillna(0.0)

    return feats
