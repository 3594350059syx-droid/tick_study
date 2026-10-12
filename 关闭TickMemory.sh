#!/usr/bin/env bash

set -u
set -o pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)" || {
  echo "ERROR: 无法确定脚本所在目录。" >&2
  exit 1
}

SERVER_SCRIPT="$SCRIPT_DIR/server.js"

if [[ ! -f "$SERVER_SCRIPT" ]]; then
  echo "ERROR: 未找到服务器文件：$SERVER_SCRIPT" >&2
  exit 1
fi

find_server_pids() {
  ps -eo pid=,args= | awk -v server_script="$SERVER_SCRIPT" '
    $1 ~ /^[0-9]+$/ && $2 ~ /(^|\/)node([0-9.]*)?$/ && $3 == server_script { print $1 }
  '
}

mapfile -t SERVER_PIDS < <(find_server_pids)

if (( ${#SERVER_PIDS[@]} == 0 )); then
  echo "TickMemory 当前没有运行。"
  exit 0
fi

echo "正在关闭 TickMemory..."
for pid in "${SERVER_PIDS[@]}"; do
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
  fi
done

for ((attempt = 1; attempt <= 10; attempt++)); do
  remaining=0
  for pid in "${SERVER_PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      remaining=1
      break
    fi
  done

  if (( remaining == 0 )); then
    echo "TickMemory 已关闭。"
    exit 0
  fi
  sleep 1
done

echo "提示：服务器未在 10 秒内退出，正在强制关闭..." >&2
for pid in "${SERVER_PIDS[@]}"; do
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null || true
  fi
done

sleep 1
if find_server_pids | grep -q .; then
  echo "ERROR: 无法关闭 TickMemory，请检查进程权限。" >&2
  exit 1
fi

echo "TickMemory 已强制关闭。"