"""
Run this script whenever knowledge base files are updated.
  python ingest.py
Wipes the old ChromaDB and rebuilds it from scratch.
"""
from rag import build_vector_store

if __name__ == "__main__":
    build_vector_store()
