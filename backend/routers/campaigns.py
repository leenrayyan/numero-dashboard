from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
from database import get_db
from models import Campaign, CampaignRecipient

router = APIRouter()


class CampaignCreate(BaseModel):
    name: str
    offer_code: Optional[str] = None
    message_template: Optional[str] = None
    segment_filter: Optional[str] = None
    product_filter: Optional[str] = None
    country_filter: Optional[str] = None
    recency_min_filter: Optional[int] = None
    recency_max_filter: Optional[int] = None
    spend_min_filter: Optional[float] = None
    spend_max_filter: Optional[float] = None
    total_targeted: Optional[int] = 0
    status: Optional[str] = "draft"


@router.get("/funnel-summary")
async def funnel_summary(db: AsyncSession = Depends(get_db)):
    """Aggregate reactivation funnel across every campaign — feeds the dashboard funnel card."""
    row = (await db.execute(select(
        func.coalesce(func.sum(Campaign.total_targeted),  0).label("targeted"),
        func.coalesce(func.sum(Campaign.sent_count),      0).label("sent"),
        func.coalesce(func.sum(Campaign.delivered_count), 0).label("delivered"),
        func.coalesce(func.sum(Campaign.read_count),      0).label("read"),
        func.coalesce(func.sum(Campaign.replied_count),   0).label("replied"),
        func.coalesce(func.sum(Campaign.converted_count), 0).label("converted"),
    ))).fetchone()
    return {
        "targeted":  row.targeted,
        "sent":      row.sent,
        "delivered": row.delivered,
        "read":      row.read,
        "replied":   row.replied,
        "converted": row.converted,
    }


@router.get("/")
async def list_campaigns(
    db: AsyncSession = Depends(get_db),
    status: Optional[str] = Query(None),
):
    q = select(Campaign).order_by(Campaign.created_at.desc())
    if status:
        q = q.where(Campaign.status == status)
    result = await db.execute(q)
    return [_serialize(c) for c in result.scalars().all()]


@router.post("/")
async def create_campaign(data: CampaignCreate, db: AsyncSession = Depends(get_db)):
    c = Campaign(**data.model_dump())
    if data.status == "sent":
        c.sent_at = datetime.now(timezone.utc)
        c.sent_count = data.total_targeted or 0
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return _serialize(c)


@router.get("/{campaign_id}")
async def get_campaign(campaign_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Campaign).where(Campaign.id == campaign_id))
    c = result.scalar_one_or_none()
    if not c:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return _serialize(c)


@router.put("/{campaign_id}/status")
async def update_status(
    campaign_id: int,
    status: str,
    db: AsyncSession = Depends(get_db),
):
    """wa-bot calls this to move campaign through queued→sending→sent."""
    result = await db.execute(select(Campaign).where(Campaign.id == campaign_id))
    c = result.scalar_one_or_none()
    if not c:
        raise HTTPException(status_code=404, detail="Campaign not found")
    c.status = status
    if status == "sent":
        c.sent_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(c)
    return _serialize(c)


@router.post("/{campaign_id}/recipients")
async def upsert_recipient(
    campaign_id: int,
    user_id: int,
    phone_number: Optional[str] = None,
    wa_message_id: Optional[str] = None,
    status: str = "sent",
    db: AsyncSession = Depends(get_db),
):
    """wa-bot calls this once per message sent to record the recipient."""
    rec = CampaignRecipient(
        campaign_id=campaign_id,
        user_id=user_id,
        phone_number=phone_number,
        wa_message_id=wa_message_id,
        status=status,
        sent_at=datetime.now(timezone.utc),
    )
    db.add(rec)
    await db.commit()
    return {"ok": True}


@router.patch("/recipients/event")
async def recipient_event(
    wa_message_id: str,
    event: str,          # delivered | read | replied | converted | failed
    db: AsyncSession = Depends(get_db),
):
    """wa-bot webhook calls this when Meta sends a delivery/read/reply event."""
    result = await db.execute(
        select(CampaignRecipient).where(CampaignRecipient.wa_message_id == wa_message_id)
    )
    rec = result.scalar_one_or_none()
    if not rec:
        return {"ok": True, "note": "recipient not found — non-campaign message"}

    now = datetime.now(timezone.utc)
    if event == "delivered" and not rec.delivered_at:
        rec.delivered_at = now
        rec.status = "delivered"
    elif event == "read" and not rec.read_at:
        rec.read_at = now
        rec.status = "read"
    elif event == "replied" and not rec.replied_at:
        rec.replied_at = now
        rec.status = "replied"
    elif event == "converted" and not rec.converted_at:
        rec.converted_at = now
        rec.status = "converted"
    elif event == "failed":
        rec.status = "failed"

    await db.commit()

    # Re-aggregate campaign-level stats
    campaign_id = rec.campaign_id
    stats = (await db.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE status IN ('sent','delivered','read','replied','converted')) AS sent,
            COUNT(*) FILTER (WHERE status IN ('delivered','read','replied','converted'))        AS delivered,
            COUNT(*) FILTER (WHERE status IN ('read','replied','converted'))                   AS read,
            COUNT(*) FILTER (WHERE status IN ('replied','converted'))                          AS replied,
            COUNT(*) FILTER (WHERE status = 'converted')                                      AS converted
        FROM campaign_recipients WHERE campaign_id = :cid
    """), {"cid": campaign_id})).fetchone()

    camp_result = await db.execute(select(Campaign).where(Campaign.id == campaign_id))
    camp = camp_result.scalar_one_or_none()
    if camp:
        camp.sent_count      = stats.sent      or 0
        camp.delivered_count = stats.delivered or 0
        camp.read_count      = stats.read      or 0
        camp.replied_count   = stats.replied   or 0
        camp.converted_count = stats.converted or 0
        await db.commit()

    return {"ok": True}


@router.patch("/{campaign_id}/stats")
async def update_stats(
    campaign_id: int,
    delivered: Optional[int] = None,
    read: Optional[int] = None,
    replied: Optional[int] = None,
    converted: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
):
    """Called by the wa-bot webhook handler to update delivery stats."""
    result = await db.execute(select(Campaign).where(Campaign.id == campaign_id))
    c = result.scalar_one_or_none()
    if not c:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if delivered  is not None: c.delivered_count  = delivered
    if read       is not None: c.read_count       = read
    if replied    is not None: c.replied_count    = replied
    if converted  is not None: c.converted_count  = converted
    await db.commit()
    await db.refresh(c)
    return _serialize(c)


def _serialize(c: Campaign) -> dict:
    return {
        "id":                 c.id,
        "name":               c.name,
        "offer_code":         c.offer_code,
        "message_template":   c.message_template,
        "segment_filter":     c.segment_filter,
        "product_filter":     c.product_filter,
        "country_filter":     c.country_filter,
        "recency_min_filter": c.recency_min_filter,
        "recency_max_filter": c.recency_max_filter,
        "total_targeted":     c.total_targeted,
        "status":             c.status,
        "created_at":         c.created_at.isoformat() if c.created_at else None,
        "sent_at":            c.sent_at.isoformat()    if c.sent_at    else None,
        "sent_count":         c.sent_count      or 0,
        "delivered_count":    c.delivered_count or 0,
        "read_count":         c.read_count      or 0,
        "replied_count":      c.replied_count   or 0,
        "converted_count":    c.converted_count or 0,
    }
