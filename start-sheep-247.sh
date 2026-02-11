#!/bin/bash
# ============================================================================
# SHEEP AI - 24/7 Launch Script
# Keeps Telegram bot + proxy alive. Prevents sleep even when lid is closed.
# ============================================================================
#
# LID CLOSED: caffeinate alone does NOT prevent lid-close sleep! We use pmset
# to disable sleep entirely while SHEEP runs. Run stop-sheep-247.sh to restore
# sleep before putting the MacBook in a bag (heat risk).
#
# For LaunchAgent (no password prompt): add to sudoers:
#   mustafabulutoglulari ALL=(ALL) NOPASSWD: /usr/bin/pmset
# ============================================================================

SHEEP_DIR="/Users/mustafabulutoglulari/Desktop/SHEEP_v3.0.0"
LOG_DIR="/tmp/sheep"
PID_FILE="$LOG_DIR/sheep.pid"
mkdir -p "$LOG_DIR"

echo "🐑 SHEEP AI 24/7 Launcher"
echo "=========================="

# Unset any poisoned env vars
unset CLAUDE_CODE_OAUTH_TOKEN

# 0. Prevent sleep when lid is closed (so you don't lose Telegram connection)
echo "[0/4] Preventing sleep (including lid closed)..."
if sudo -n pmset -a disablesleep 1 2>/dev/null; then
    echo "  ✓ Lid-close sleep disabled (pmset) - safe to close lid"
else
    echo "  ⚠ pmset failed (need sudo). Caffeinate will help when lid is OPEN only."
    echo "    To enable lid-close: run manually: sudo pmset -a disablesleep 1"
    echo "    Or add to sudoers: $(whoami) ALL=(ALL) NOPASSWD: /usr/bin/pmset"
fi

# 1. Start claude-max-api-proxy if not running
if ! curl -s http://localhost:3456/health > /dev/null 2>&1; then
    echo "[1/4] Starting claude-max-api-proxy..."
    nohup claude-max-api > "$LOG_DIR/proxy.log" 2>&1 &
    sleep 5
    if curl -s http://localhost:3456/health > /dev/null 2>&1; then
        echo "  ✓ Proxy running on localhost:3456"
    else
        echo "  ✗ Proxy failed to start. Check $LOG_DIR/proxy.log"
    fi
else
    echo "[1/4] Proxy already running ✓"
fi

# 2. Start SHEEP Telegram bot
echo "[2/4] Starting SHEEP Telegram bot..."
cd "$SHEEP_DIR"
nohup npx tsx src/main.ts > "$LOG_DIR/sheep-bot.log" 2>&1 &
SHEEP_PID=$!
sleep 8

if ps -p $SHEEP_PID > /dev/null 2>&1; then
    echo "  ✓ SHEEP bot running (PID: $SHEEP_PID)"
else
    echo "  ✗ SHEEP bot failed. Check $LOG_DIR/sheep-bot.log"
fi

# 3. Enable caffeinate (backup: prevent idle sleep)
echo "[3/4] Enabling caffeinate (backup no-sleep)..."
caffeinate -d -i -s &
CAFF_PID=$!
echo "  ✓ Caffeinate active (PID: $CAFF_PID)"

# 4. Save PIDs for stop script
echo "[4/4] Saving PIDs..."
echo "${SHEEP_PID:-} ${CAFF_PID:-}" > "$PID_FILE"
echo "  ✓ PIDs saved to $PID_FILE"

echo ""
echo "🐑 SHEEP AI is LIVE on Telegram!"
echo "   Bot: @CountingSheep_bot"
echo "   Proxy: localhost:3456 (Max Plan, \$0/token)"
echo "   Logs: $LOG_DIR/"
echo "   Lid closed: Connection will stay alive ✓"
echo ""
echo "To stop (and restore sleep):  ./stop-sheep-247.sh"
echo "To check:                    tail -f $LOG_DIR/sheep-bot.log"
