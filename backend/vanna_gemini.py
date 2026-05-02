"""
Custom Vanna adapter using google-genai (new SDK, replaces deprecated google-generativeai).
"""
import os

# Pydantic v2 removed ArbitraryTypeWarning — patch it back for older chromadb/vanna
import pydantic.warnings as _pw
if not hasattr(_pw, "ArbitraryTypeWarning"):
    _pw.ArbitraryTypeWarning = type("ArbitraryTypeWarning", (UserWarning,), {})

from dotenv import load_dotenv
from google import genai
from google.genai import types as genai_types
from vanna.base import VannaBase
from vanna.chromadb import ChromaDB_VectorStore

load_dotenv()

_vanna_instance = None


class VannaGemini(ChromaDB_VectorStore, VannaBase):
    def __init__(self, config: dict = None):
        config = config or {}
        ChromaDB_VectorStore.__init__(self, config=config)
        VannaBase.__init__(self, config=config)

        api_key = config.get("api_key") or os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY not set")

        self._client = genai.Client(api_key=api_key)
        self._model_name = config.get("model", "gemini-2.5-flash")

    # --- Vanna abstract methods ---

    def system_message(self, message: str) -> dict:
        return {"role": "user", "parts": [f"[System]: {message}"]}

    def user_message(self, message: str) -> dict:
        return {"role": "user", "parts": [message]}

    def assistant_message(self, message: str) -> dict:
        return {"role": "model", "parts": [message]}

    def submit_prompt(self, prompt, **kwargs) -> str:
        if isinstance(prompt, list):
            # Build Content objects; merge consecutive same-role messages
            # (Gemini requires strictly alternating user/model turns)
            contents = []
            for msg in prompt:
                role = msg.get("role", "user")
                text = " ".join(p for p in (msg.get("parts") or []) if isinstance(p, str))
                if not text:
                    continue
                if contents and contents[-1].role == role:
                    # Merge into previous
                    prev_text = contents[-1].parts[0].text
                    contents[-1] = genai_types.Content(
                        role=role,
                        parts=[genai_types.Part(text=prev_text + "\n" + text)],
                    )
                else:
                    contents.append(
                        genai_types.Content(role=role, parts=[genai_types.Part(text=text)])
                    )
        else:
            contents = str(prompt)

        response = self._client.models.generate_content(
            model=self._model_name,
            contents=contents,
        )
        return response.text


def get_vanna() -> VannaGemini:
    """Returns a singleton Vanna instance connected to PostgreSQL."""
    global _vanna_instance
    if _vanna_instance is not None:
        return _vanna_instance

    vn = VannaGemini(config={
        "api_key": os.getenv("GEMINI_API_KEY"),
        "model": "gemini-2.5-flash",
        "path": "./chroma_db",
    })

    vn.connect_to_postgres(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "5432")),
        dbname=os.getenv("DB_NAME", "dormant_users"),
        user=os.getenv("DB_USER", "admin"),
        password=os.getenv("DB_PASSWORD", "admin123"),
    )

    _vanna_instance = vn
    return vn
