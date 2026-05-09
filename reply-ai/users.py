import json
import os
from datetime import datetime

DATA_DIR = os.path.join(os.path.dirname(__file__), 'data', 'users')
os.makedirs(DATA_DIR, exist_ok=True)

DEFAULT_PROFILE = {
    "user_id": None,
    "name": None,
    "country": None,
    "segment": "unknown",
    "offer_id": None,
    "language": "en",
    "conversation": [],
    "created_at": None,
    "last_active": None
}

def get_user(user_id: str) -> dict:
    path = os.path.join(DATA_DIR, f"{user_id}.json")
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    profile = {**DEFAULT_PROFILE, "user_id": user_id, "created_at": datetime.utcnow().isoformat()}
    _save(path, profile)
    return profile

def save_user(user_id: str, profile: dict):
    path = os.path.join(DATA_DIR, f"{user_id}.json")
    profile["last_active"] = datetime.utcnow().isoformat()
    _save(path, profile)

def add_message(user_id: str, role: str, content: str):
    profile = get_user(user_id)
    profile["conversation"].append({
        "role": role,
        "content": content,
        "ts": datetime.utcnow().isoformat()
    })
    if len(profile["conversation"]) > 50:
        profile["conversation"] = profile["conversation"][-50:]
    save_user(user_id, profile)

def get_recent_history(user_id: str, n: int = 10) -> list:
    profile = get_user(user_id)
    history = profile.get("conversation", [])
    return [{"role": m["role"], "content": m["content"]} for m in history[-n:]]

def _save(path: str, profile: dict):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(profile, f, indent=2, ensure_ascii=False)
