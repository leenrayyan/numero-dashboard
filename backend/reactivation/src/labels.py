"""Reactivation label construction.

A customer is *inactive* at cutoff T if their last purchase in the product group
was more than N days before T. They are *reactivated* if they made any purchase
in the same group within [T, T + M days).
"""
import pandas as pd


def build_labels(df: pd.DataFrame, cutoff, N: int, M: int, group: str) -> pd.DataFrame:
    """One row per pre-cutoff customer in the group.

    Columns: id_client, last_purchase, days_since_last, inactive, reactivated.
    `reactivated` is only meaningful when `inactive` is True.
    """
    cutoff = pd.Timestamp(cutoff)
    g = df[df['product_group'] == group]
    pre = g[g['purchase_date'] < cutoff]
    post = g[(g['purchase_date'] >= cutoff) &
             (g['purchase_date'] < cutoff + pd.Timedelta(days=M))]

    last = pre.groupby('id_client')['purchase_date'].max().rename('last_purchase')
    out = last.reset_index()
    out['days_since_last'] = (cutoff - out['last_purchase']).dt.days
    out['inactive'] = out['days_since_last'] > N

    reactivated_ids = set(post['id_client'].unique())
    out['reactivated'] = out['inactive'] & out['id_client'].isin(reactivated_ids)
    return out
