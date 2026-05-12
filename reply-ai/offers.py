import json
import os

DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')


def _load(filename: str) -> dict:
    with open(os.path.join(DATA_DIR, filename), 'r', encoding='utf-8') as f:
        return json.load(f)


def get_offer(code: str) -> dict | None:
    """Look up an offer by its promo code (e.g. 'CALL10')."""
    if not code:
        return None
    return _load('offers.json').get(code.upper())


def get_all_offers() -> dict:
    return _load('offers.json')


def get_segment(segment: str) -> dict:
    segments = _load('segments.json')
    return segments.get(segment, segments.get('unknown', {}))


def get_offer_for_user(segment: str, product_group: str, recency_days: int) -> dict | None:
    """
    Rule-based offer selector (NOT AI) — mirrors the frontend matchOffer() logic.
    Maps (segment → tier) via lookup table, bumps tier for very-dormant users,
    then picks a hardcoded promo code per (product, tier). Pure deterministic
    decision tree; no model or LLM involved.
    """
    # Tiers mirror frontend/src/pages/Campaigns.jsx TIER_MAP — v3 segment names.
    TIER_MAP = {
        # Tier 1 — top-of-tier loyalists, light incentive
        "Calls - Regular Calling Offer Users":   1,
        "eSIM - High-Value Bundle Subscribers":  1,
        "Virtual - High-Spend Power Users":      1,
        # Tier 2 — mid-tier upsell candidates
        "eSIM - High-Velocity Light Spenders":   2,
        "Virtual - Mid-Tier Phone Plan Holders": 2,
        # Tier 3 — at-risk / dormant within product
        "eSIM - Dormant Local Data Users":       3,
        # Tier 4 — low-value casual, heaviest reactivation push
        "Calls - Infrequent Casual Users":       4,
        "Virtual - Light Occasional Users":      4,
    }
    tier = TIER_MAP.get(segment, 2)

    # Very dormant → one tier more aggressive
    if recency_days and recency_days >= 365 and tier < 4:
        tier += 1

    product = product_group or "All"

    if product == "Calls":
        code = ["CALL5", "CALL10", "CALL15", "CALL20"][tier - 1]
    elif product == "Data eSIM":
        code = {1: "TRAVEL5", 2: "ONLINE5"}.get(tier, "SAVEBIG")
    elif product == "Virtual Number":
        code = ["NUMBER5", "NUMBER10", "NUMBER15", "NUMBER20"][tier - 1]
    else:
        code = "SAVEBIG" if tier >= 3 else "LOCAL5"

    return get_offer(code)


def format_offer(offer: dict | None) -> str:
    if not offer:
        return "No specific offer assigned. Direct user to www.numeroesim.com and help them find the right plan."
    lines = [
        f"Promo Code: {offer['code']}",
        f"Offer: {offer['label']} — {offer['discount']}",
        f"Details: {offer['description']}",
        f"Validity: {offer['expiry_days']} days",
    ]
    return "\n".join(lines)


def format_segment(segment_data: dict) -> str:
    if not segment_data:
        return ""
    urgency_map = {"low": "low urgency", "medium": "moderate urgency", "high": "high urgency — act now"}
    urgency = urgency_map.get(segment_data.get("urgency", "low"), "")
    return (
        f"Segment: {segment_data.get('description', '')}\n"
        f"Urgency: {urgency}\n"
        f"Tone guidance: {segment_data.get('tone_notes', '')}"
    )
