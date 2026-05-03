"""Load Numero purchase data with parquet caching."""
from pathlib import Path
import pandas as pd

PRODUCT_GROUP_MAP = {
    'Phone Number': 'Virtual Number',
    'Local Calling Plan': 'Virtual Number',
    'EU Bundle': 'Virtual Number',
    'Full eSIM': 'Data eSIM',
    'Local eSIM': 'Data eSIM',
    'Data eSIM': 'Data eSIM',
    'Calling Offers': 'Calls',
    'Recharge': 'Calls',
}


def load_purchases(xlsx_path: str | Path, cache_path: str | Path | None = None) -> pd.DataFrame:
    """Load purchase data from xlsx, caching as parquet for speed.

    Returns a dataframe with parsed dates, renamed columns, and product_group attached.
    """
    xlsx_path = Path(xlsx_path)
    if cache_path is None:
        cache_path = xlsx_path.with_suffix('.parquet')
    cache_path = Path(cache_path)

    if cache_path.exists() and cache_path.stat().st_mtime >= xlsx_path.stat().st_mtime:
        df = pd.read_parquet(cache_path)
    else:
        df = pd.read_excel(xlsx_path)
        df = df.rename(columns={'prodcut': 'product'})
        df['purchase_date'] = pd.to_datetime(df['purchase_date'])
        df['register_date'] = pd.to_datetime(df['register_date'])
        df['product_group'] = df['product'].map(PRODUCT_GROUP_MAP)
        df.to_parquet(cache_path, index=False)

    return df
