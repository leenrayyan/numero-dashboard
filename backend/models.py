"""
SQLAlchemy models — one row per user, aggregated from 3 product-type CSVs.
Primary product = where user spent most. Cluster from that product.
"""
from sqlalchemy import Column, String, Float, Integer, Boolean, DateTime, Text, JSON, BigInteger
from sqlalchemy.sql import func
from database import Base


class User(Base):
    __tablename__ = "users"

    id_client             = Column(BigInteger, primary_key=True, index=True)
    user_country          = Column(Text, nullable=True)
    register_date         = Column(DateTime, nullable=True)
    first_purchase        = Column(DateTime, nullable=True)
    last_purchase         = Column(DateTime, nullable=True)

    # Aggregated across all products
    recency               = Column(Integer, nullable=True)   # days since most recent purchase
    customer_age          = Column(Integer, nullable=True)   # days since registration
    total_spent           = Column(Float, nullable=True)     # sum across all products
    purchase_frequency    = Column(Integer, nullable=True)   # total purchases across all products

    # Per-product spend & frequency
    calls_spent           = Column(Float, nullable=True, default=0)
    esim_spent            = Column(Float, nullable=True, default=0)
    virtual_spent         = Column(Float, nullable=True, default=0)
    calls_frequency       = Column(Integer, nullable=True, default=0)
    esim_frequency        = Column(Integer, nullable=True, default=0)
    virtual_frequency     = Column(Integer, nullable=True, default=0)

    # Per-product cluster names
    calls_cluster         = Column(Text, nullable=True)
    esim_cluster          = Column(Text, nullable=True)
    virtual_cluster       = Column(Text, nullable=True)

    # Per-product PCA coords. Each product has its own PCA fit (different
    # feature set per group), so coords are NOT comparable across products.
    # NULL when the user doesn't buy in that product.
    calls_pc1             = Column(Float, nullable=True)
    calls_pc2             = Column(Float, nullable=True)
    esim_pc1              = Column(Float, nullable=True)
    esim_pc2              = Column(Float, nullable=True)
    virtual_pc1           = Column(Float, nullable=True)
    virtual_pc2           = Column(Float, nullable=True)

    # Per-product behavioural metrics — needed because membership-based
    # filtering ("show me Calls users") only makes sense if the metrics
    # we filter & aggregate by are also per-product. Otherwise filtering
    # by Calls + recency<=30 silently includes users whose recent activity
    # was in another product. NULL when the user doesn't buy that product.
    calls_recency         = Column(Integer, nullable=True)
    esim_recency          = Column(Integer, nullable=True)
    virtual_recency       = Column(Integer, nullable=True)

    calls_aov             = Column(Float, nullable=True)
    esim_aov              = Column(Float, nullable=True)
    virtual_aov           = Column(Float, nullable=True)

    calls_velocity        = Column(Float, nullable=True)
    esim_velocity         = Column(Float, nullable=True)
    virtual_velocity      = Column(Float, nullable=True)

    calls_gap_days        = Column(Float, nullable=True)
    esim_gap_days         = Column(Float, nullable=True)
    virtual_gap_days      = Column(Float, nullable=True)

    # Primary product (highest spend) and its cluster
    primary_product_group = Column(Text, nullable=True, index=True)
    cluster_id            = Column(Integer, nullable=True, index=True)
    segment               = Column(Text, nullable=True, index=True)   # cluster_name from primary product

    # All product groups this user buys in (comma-joined). Preserves cross-category info
    # for ~19% of customers who buy in 2+ categories. e.g. "Calls, Virtual Number".
    product_groups        = Column(Text, nullable=True)
    # Top product_types this user has purchased — comma-joined, ordered by frequency
    # (e.g., "USA Offers, Landline, Germany"). Useful for richer audience targeting
    # since one user may span multiple sub-types within a product group.
    product_types         = Column(Text, nullable=True)
    # Each user's *most-frequent* product NAME (the level between product_group
    # and product_type). E.g. "Recharge", "Phone Number", "Data eSIM". 8 distinct
    # values across the dataset — clean to colour by in the cluster scatter.
    dominant_product      = Column(Text, nullable=True)

    # User attributes from purchase data — used as filter dimensions in the dashboard.
    # phone_number is NOT exposed in the dashboard UI; it's used only by the WhatsApp
    # campaign sender. platform / language / email are the new filterable dimensions.
    phone_number          = Column(Text, nullable=True)               # WhatsApp number (E.164 without +)
    platform              = Column(Text, nullable=True, index=True)   # iOS / Android
    language              = Column(Text, nullable=True, index=True)   # english / french / spanish / arabic
    email                 = Column(Text, nullable=True)               # nullable — ~85% null in source data

    # Campaign & reactivation tracking
    whatsapp_opted_in     = Column(Boolean, default=True, nullable=True)
    last_campaign_at      = Column(DateTime, nullable=True)           # last time a campaign was sent to this user
    campaigns_sent        = Column(Integer, default=0, nullable=True)
    reactivation_score    = Column(Float, nullable=True)              # 0-1 probability (set by teammate's model)


class Campaign(Base):
    __tablename__ = "campaigns"

    id                 = Column(Integer, primary_key=True, autoincrement=True)
    name               = Column(Text, nullable=False)
    offer_code         = Column(Text, nullable=True)
    message_template   = Column(Text, nullable=True)

    # Audience filters captured at send time
    segment_filter     = Column(Text,    nullable=True)
    product_filter     = Column(Text,    nullable=True)
    country_filter     = Column(Text,    nullable=True)
    recency_min_filter = Column(Integer, nullable=True)
    recency_max_filter = Column(Integer, nullable=True)
    spend_min_filter   = Column(Float,   nullable=True)
    spend_max_filter   = Column(Float,   nullable=True)

    total_targeted     = Column(Integer, default=0)
    status             = Column(Text, default="draft")  # draft | queued | sending | sent | completed

    created_at         = Column(DateTime, server_default=func.now())
    sent_at            = Column(DateTime, nullable=True)

    # Delivery stats (updated by wa-bot webhook)
    sent_count         = Column(Integer, default=0)
    delivered_count    = Column(Integer, default=0)
    read_count         = Column(Integer, default=0)
    replied_count      = Column(Integer, default=0)
    converted_count    = Column(Integer, default=0)


class CampaignRecipient(Base):
    """One row per (campaign, user) — tracks per-user WhatsApp delivery lifecycle."""
    __tablename__ = "campaign_recipients"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    campaign_id   = Column(Integer, nullable=False, index=True)
    user_id       = Column(BigInteger, nullable=False, index=True)   # id_client
    phone_number  = Column(Text, nullable=True)
    wa_message_id = Column(Text, nullable=True, index=True)          # Meta's wamid for delivery tracking

    # Lifecycle status per recipient
    status        = Column(Text, default="sent")  # sent | delivered | read | replied | converted | failed

    sent_at       = Column(DateTime, nullable=True)
    delivered_at  = Column(DateTime, nullable=True)
    read_at       = Column(DateTime, nullable=True)
    replied_at    = Column(DateTime, nullable=True)
    converted_at  = Column(DateTime, nullable=True)

    created_at    = Column(DateTime, server_default=func.now())


class ClusterRun(Base):
    __tablename__ = "cluster_runs"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    run_at        = Column(DateTime, server_default=func.now())
    n_clusters    = Column(Integer)
    algorithm     = Column(String, default="kmeans")
    features_used = Column(JSON)
    centroids     = Column(JSON)
    cluster_stats = Column(JSON)
    is_active     = Column(Boolean, default=True)
    notes         = Column(Text, nullable=True)
