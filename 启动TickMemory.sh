#!/usr/bin/env bash

set -u
set -o pipefail

PORT=4173
URL="http://127.0.0.1:${PORT}"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)" || {
  echo "ERROR: 无法确定脚本所在目录。" >&2
  exit 1
}

cd -- "$SCRIPT_DIR" || {
  echo "ERROR: 无法切换到项目目录：$SCRIPT_DIR" >&2
  exit 1
}

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "ERROR: 未找到 Node.js，请先安装 Node.js 22.5 或更高版本。" >&2
  exit 1
fi

if ! NODE_NO_WARNINGS=1 "$NODE_BIN" -e "require('node:sqlite')" >/dev/null 2>&1; then
  echo "ERROR: 当前 Node.js 不支持 node:sqlite，请使用 Node.js 22.5 或更高版本。" >&2
  exit 1
fi

if [[ ! -f "$SCRIPT_DIR/server.js" ]]; then
  echo "ERROR: 未找到服务器文件：$SCRIPT_DIR/server.js" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "ERROR: 未找到 curl，无法检查服务器健康状态。" >&2
  exit 1
fi

if ! command -v ss >/dev/null 2>&1; then
  echo "ERROR: 未找到 ss，无法检查端口 ${PORT}。" >&2
  exit 1
fi

SERVER_LOG="$SCRIPT_DIR/server.log"
SERVER_ERR_LOG="$SCRIPT_DIR/server-err.log"

port_is_listening() {
  ss -ltnH "( sport = :${PORT} )" 2>/dev/null | grep -q .
}

health_check() {
  curl -fsS --max-time 1 "$URL/api/health" >/dev/null 2>&1
}

open_browser() {
  if [[ "${TICKMEMORY_NO_BROWSER:-}" == "1" ]]; then
    return 0
  fi

  if command -v xdg-open >/dev/null 2>&1; then
    nohup xdg-open "$URL" >/dev/null 2>&1 &
  else
    echo "提示：未找到 xdg-open，请手动打开 $URL。"
  fi
}

show_status_until_stopped() {
  while kill -0 "$1" 2>/dev/null; do
    if health_check; then
      printf '[%s] 状态：后端正常，访问地址：%s\n' "$(date '+%H:%M:%S')" "$URL"
    else
      printf '[%s] 状态：后端进程仍在运行，但健康检查失败。\n' "$(date '+%H:%M:%S')" >&2
    fi
    sleep 5
done
}

monitor_existing_server() {
  echo "TickMemory 已在运行：$URL"
  echo "当前启动脚本未接管已有进程；按 Ctrl+C 退出状态监视，不会停止该进程。"
  open_browser
  while health_check; do
    printf '[%s] 状态：后端正常，访问地址：%s\n' "$(date '+%H:%M:%S')" "$URL"
    sleep 5
  done
  echo "ERROR: TickMemory 后端已停止。" >&2
  return 1
}

if health_check; then
  monitor_existing_server
  exit $?
fi

if port_is_listening; then
  echo "ERROR: 端口 ${PORT} 已被其他服务占用，且不是可用的 TickMemory。" >&2
  echo "请检查占用端口的进程后重试。" >&2
  exit 1
fi

echo "正在启动 TickMemory 前端和后端..."
echo "服务日志会持续显示在当前终端；按 Ctrl+C 可停止 TickMemory。"

# 不使用 nohup 或重定向到后台：进程绑定当前终端，日志既显示在终端也保存到日志文件。
"$NODE_BIN" "$SCRIPT_DIR/server.js" \
  > >(tee -a "$SERVER_LOG") \
  2> >(tee -a "$SERVER_ERR_LOG" >&2) &
SERVER_PID=$!

stop_server() {
  echo
  echo "正在停止 TickMemory..."
  if kill -0 "$SERVER_PID" 2>/dev/null; then
    kill -TERM "$SERVER_PID" 2>/dev/null || true
  fi
  wait "$SERVER_PID" 2>/dev/null || true
  echo "TickMemory 已停止。"
  exit 130
}
trap stop_server INT TERM

started=0
for ((attempt = 1; attempt <= 15; attempt++)); do
  if health_check; then
    started=1
    break
  fi

  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    break
  fi

  sleep 1
done

if (( started == 0 )); then
  echo "ERROR: 服务器未能在 15 秒内启动。" >&2
  echo "请查看错误日志：$SERVER_ERR_LOG" >&2
  if [[ -s "$SERVER_ERR_LOG" ]]; then
    echo "最近的错误日志：" >&2
    tail -n 20 "$SERVER_ERR_LOG" >&2
  fi
  kill -TERM "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  exit 1
fi

echo "TickMemory 启动成功：$URL"
open_browser
show_status_until_stopped "$SERVER_PID"

wait "$SERVER_PID"
SERVER_EXIT=$?
trap - INT TERM
if (( SERVER_EXIT == 0 )); then
  echo "TickMemory 已停止。"
else
  echo "ERROR: TickMemory 已退出，退出码：$SERVER_EXIT" >&2
fi
exit "$SERVER_EXIT"
