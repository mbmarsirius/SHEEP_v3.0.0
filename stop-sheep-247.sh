#!/bin/bash
# ============================================================================
# SHEEP AI - Stop Script
# Stops bot + caffeinate and RESTORES sleep (so lid-close works normally again).
# Run this before putting your MacBook in a bag to avoid heat damage.
# ============================================================================

LOG_DIR="/tmp/sheep"
PID_FILE="$LOG_DIR/sheep.pid"

echo "🐑 Stopping SHEEP AI..."
echo ""

# 1. Kill SHEEP and caffeinate from PID file
if [[ -f "$PID_FILE" ]]; then
    PIDS=$(cat "$PID_FILE")
    for pid in $PIDS; do
        if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null
            echo "  ✓ Stopped process $pid"
        fi
    done
    rm -f "$PID_FILE"
else
    # Fallback: find and kill by process name
    pkill -f "SHEEP_v3.0.0.*main.ts" 2>/dev/null && echo "  ✓ Stopped SHEEP bot"
    pkill caffeinate 2>/dev/null && echo "  ✓ Stopped caffeinate"
fi

# 2. Restore normal sleep (IMPORTANT: lid will sleep again)
echo ""
echo "Restoring normal sleep behavior..."
if sudo -n pmset -a disablesleep 0 2>/dev/null; then
    echo "  ✓ Sleep re-enabled (lid close will sleep again)"
else
    echo "  ⚠ Run manually: sudo pmset -a disablesleep 0"
fi

echo ""
echo "🐑 SHEEP stopped. Safe to close lid and put in bag."
