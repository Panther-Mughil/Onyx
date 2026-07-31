#!/bin/bash
echo "======================================="
echo "   Starting Onyx Dev Environment"
echo "======================================="

# Trap Ctrl+C (SIGINT) and clean up background processes
trap 'echo "Stopping servers..."; kill $(jobs -p) 2>/dev/null; exit' SIGINT SIGTERM

cd "$(dirname "$0")"

echo "Starting Rust Backend..."
cd backend
cargo run &
BACKEND_PID=$!

cd ..

echo "Starting Vite Frontend..."
cd frontend
npm run dev &
FRONTEND_PID=$!

echo ""
echo "Both servers are running in the background."
echo "Press Ctrl+C to stop both servers gracefully."
echo ""

# Wait for background processes
wait $BACKEND_PID $FRONTEND_PID
