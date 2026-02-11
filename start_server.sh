#!/bin/bash
# Start the Flask API server for the Treasury Analysis website

echo "🚀 Starting Treasury Analysis API Server..."
echo ""
echo "Server will run on: http://localhost:5001"
echo "Press Ctrl+C to stop the server"
echo ""

# Activate virtual environment if it exists
if [ -d "venv" ]; then
    echo "Activating virtual environment..."
    source venv/bin/activate
fi

# Start the server
python3 api_server.py
