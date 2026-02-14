#!/bin/bash
# ============================================================================
# SHEEP AI - Watchdog (Otonom Restart)
# ============================================================================
#
# Rate limit veya crash durumunda SHEEP bot'unu OTOMATIK yeniden başlatır.
# Model değişikliği YOK — aynı modellerle devam eder.
#
# Kullanım: ./watchdog-openclaw.sh
# Arka planda: nohup ./watchdog-openclaw.sh >> /tmp/sheep/watchdog.log 2>&1 &
#
# OpenClaw kullanıyorsanız: OPENCLAW_CMD="openclaw start" ./watchdog-openclaw.sh
#
# ============================================================================

SHEEP_DIR="/Users/mustafabulutoglulari/Desktop/SHEEP_v3.0.0"
LOG_DIR="/tmp/sheep"
RESTART_DELAY=90
mkdir -p "$LOG_DIR"

cd "$SHEEP_DIR"

# Varsayılan: SHEEP standalone bot (OpenClaw yüklü değilse)
AGENT_CMD="${AGENT_CMD:-npx tsx src/main.ts}"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 🐑 SHEEP Watchdog başlatıldı"
echo "[$(date '+%Y-%m-%d %H:%M:%S')]    Komut: $AGENT_CMD"
echo "[$(date '+%Y-%m-%d %H:%M:%S')]    Restart delay: ${RESTART_DELAY}s"
echo ""

while true; do
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ▶ SHEEP bot başlatılıyor..."
    $AGENT_CMD 2>&1 | tee -a "$LOG_DIR/sheep-bot.log"
    EXIT_CODE=$?
    
    echo ""
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠ SHEEP bot durdu (exit: $EXIT_CODE)"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⏳ ${RESTART_DELAY} saniye bekleniyor (cooldown) → restart..."
    sleep "$RESTART_DELAY"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 🔄 Yeniden başlatılıyor..."
    echo ""
done
