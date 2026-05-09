#!/bin/bash
# Start the full dev environment

echo "Starting Postgres + Redis..."
docker compose up -d postgres redis

echo "Waiting for Postgres to be ready..."
sleep 3

echo ""
echo "Run in separate terminals:"
echo "  Terminal 1 (backend):  cd backend && uvicorn main:app --reload --port 8000"
echo "  Terminal 2 (frontend): cd frontend && npm run dev"
echo ""
echo "First-time setup (populates the local DB from per-product clustered CSVs):"
echo "  cd backend && python scripts/seed.py"
echo "  cd backend && python scripts/train_vanna.py --reset"
echo ""
echo "Ingest reactivation scores (run whenever the team produces a new"
echo "dormant_customers_scored.csv from cluster-reactivation-pipelines-v2.ipynb):"
echo "  cd backend && python scripts/ingest_reactivation_scores.py [path/to/csv]"
