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
echo "First time setup (after adding your CSV):"
echo "  cd backend && python scripts/seed.py --csv ../your_clustered_users.csv"
echo "  cd backend && python scripts/train_vanna.py"
