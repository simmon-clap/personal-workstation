#!/bin/bash
# IM 助理看门狗（2026-11-03）
#
# 要解决的问题（反复发生）：
#   DSH 桌面端 host 停止后**不会自己重启**，IM 插件跑在 host 里，于是微信/飞书一直离线，
#   直到有人手动 Cmd+Q 重开。用户的原话是「这个长期以来都是，需要根本性解决」。
#
# 判据不是"有没有消息"——没人聊天时本来就没消息。判据是：
#   ① host 进程在不在；
#   ② host 启动之后，IM 插件有没有留下过 [boot]（没有 = 插件没加载成功，
#      典型原因：profile 里的 fork 版本与宿主 peer 不匹配）；
# 任一不满足 → 退出并重开 DSH。
#
# 防抖动：30 分钟内最多重开一次（写到状态文件里），避免插件持续坏掉时无限重启。
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

LOG="$HOME/.dsh/im-watchdog.log"
GW="$HOME/.dsh/dsh-im-connect/gateway.log"
STATE="$HOME/.dsh/im-watchdog.state"
APP="DeepSeek Harness"
MIN_GAP=1800          # 两次自动重开之间至少隔 30 分钟
GRACE=180             # host 起来后给插件 3 分钟加载

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

restart() {
  local reason="$1"
  local now last=0
  now=$(date +%s)
  [ -f "$STATE" ] && last=$(cat "$STATE" 2>/dev/null || echo 0)
  if [ $((now - last)) -lt "$MIN_GAP" ]; then
    log "需要重开（$reason），但 30 分钟内已经重开过一次（$(( (now-last)/60 )) 分钟前），跳过"
    return 0
  fi
  log "重开 DSH：$reason"
  osascript -e "tell application \"$APP\" to quit" >/dev/null 2>&1
  sleep 8
  open -a "$APP"
  echo "$now" > "$STATE"
}

HOST_PID=$(pgrep -f dsh-desktop-host | head -1)
if [ -z "$HOST_PID" ]; then
  restart "host 进程不在"
  exit 0
fi

# host 启动时间（格林尼治秒）
HOST_START_RAW=$(ps -o lstart= -p "$HOST_PID" 2>/dev/null | sed 's/^ *//')
HOST_START=$(date -j -f "%a %b %d %T %Y" "$HOST_START_RAW" +%s 2>/dev/null || echo 0)

# 最后一次 [boot] 的时间（gateway.log 里是 UTC ISO，截到秒）
LAST_BOOT=$(grep -a '\[boot\]' "$GW" 2>/dev/null | tail -1 | cut -c1-19)
if [ -z "$LAST_BOOT" ]; then
  # 从来没有 boot 过：给足 10 分钟再判断（第一次装可能还在初始化）
  if [ "$HOST_START" -gt 0 ] && [ $(( $(date +%s) - HOST_START )) -gt 600 ]; then
    restart "IM 插件从未启动过"
  fi
  exit 0
fi
BOOT_EPOCH=$(date -j -u -f "%Y-%m-%dT%H:%M:%S" "$LAST_BOOT" +%s 2>/dev/null || echo 0)

# 现在离 host 启动多久了
NOW=$(date +%s)
if [ "$HOST_START" -gt 0 ] && [ $((NOW - HOST_START)) -lt "$GRACE" ]; then
  exit 0   # 刚起来，还在加载，别急着判
fi

if [ "$BOOT_EPOCH" -lt "$HOST_START" ]; then
  restart "host 起来了但 IM 插件没加载（最后 boot 早于本次 host 启动）"
fi
