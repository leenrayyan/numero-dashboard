from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_chroma import Chroma
from langchain_text_splitters import MarkdownTextSplitter
from dotenv import load_dotenv
import os
import glob
import shutil

load_dotenv()

KNOWLEDGE_DIR = os.path.join(os.path.dirname(__file__), '..', 'knowledge')
CHROMA_DIR = os.path.join(os.path.dirname(__file__), 'chroma_db')

def _embeddings():
    return GoogleGenerativeAIEmbeddings(
        model="models/gemini-embedding-001",
        google_api_key=os.getenv("GEMINI_API_KEY"),
        task_type="retrieval_document"
    )

def build_vector_store():
    # Wipe existing DB to avoid stale data
    if os.path.exists(CHROMA_DIR):
        shutil.rmtree(CHROMA_DIR)
        print("Wiped old ChromaDB")

    files = glob.glob(os.path.join(KNOWLEDGE_DIR, '*.md'))
    if not files:
        raise FileNotFoundError(f"No .md files found in {KNOWLEDGE_DIR}")

    splitter = MarkdownTextSplitter(chunk_size=400, chunk_overlap=60)
    texts, metadatas = [], []

    for file in files:
        with open(file, 'r', encoding='utf-8') as f:
            content = f.read()
        chunks = splitter.split_text(content)
        source = os.path.basename(file)
        texts.extend(chunks)
        metadatas.extend([{"source": source}] * len(chunks))

    Chroma.from_texts(
        texts=texts,
        embedding=_embeddings(),
        metadatas=metadatas,
        persist_directory=CHROMA_DIR
    )
    print(f"ChromaDB built: {len(texts)} chunks from {len(files)} files")

def _get_store() -> Chroma:
    if not os.path.exists(CHROMA_DIR):
        print("ChromaDB not found - building now...")
        build_vector_store()
    return Chroma(persist_directory=CHROMA_DIR, embedding_function=_embeddings())

def retrieve_context(query: str, k: int = 4) -> str:
    store = _get_store()
    results = store.similarity_search(query, k=k)
    if not results:
        return "No relevant context found."
    return "\n\n---\n\n".join(doc.page_content for doc in results)
