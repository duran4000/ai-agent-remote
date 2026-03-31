#!/usr/bin/env bash
# Claude Remote Control Service Manager
# 支持开发环境(Dev)和生产环境(Prod)模式

set -euo pipefail

ACTION="${1:-restart}"
ENV="${2:-prod}"

if [[ "$ACTION" != "start" && "$ACTION" != "stop" && "$ACTION" != "restart" ]]; then
    echo "Usage: $0 [start|stop|restart] [dev|prod]"
    exit 1
fi

if [[ "$ENV" != "dev" && "$ENV" != "prod" ]]; then
    echo "Usage: $0 [start|stop|restart] [dev|prod]"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"
SERVER_DIR="$PROJECT_DIR/server"
CLIENT_DIR="$PROJECT_DIR/client"
LOGS_DIR="$PROJECT_DIR/logs"

# 从 config.json 读取端口配置
CONFIG_FILE="$PROJECT_DIR/config.json"
if [[ -f "$CONFIG_FILE" ]]; then
    PORT=$(node -e "const c=require('$CONFIG_FILE'); console.log(c.server?.port || 41491)")
else
    PORT=41491
fi

SERVER_LOCK_FILE="$SERVER_DIR/server.lock"
MANAGER_LOCK_FILE="$CLIENT_DIR/session-manager.lock"
SERVER_LOG_FILE="$LOGS_DIR/server.log"
SERVER_ERR_FILE="$LOGS_DIR/server-error.log"
MANAGER_LOG_FILE="$LOGS_DIR/session-manager.log"
MANAGER_ERR_FILE="$LOGS_DIR/session-manager-error.log"
PID_FILE="$LOGS_DIR/service.pids"

log() {
    local msg="$1"
    local color="${2:-0}"
    local timestamp
    timestamp=$(date +"%H:%M:%S")
    # 0=normal, 1=red, 2=green, 3=yellow, 6=cyan
    case "$color" in
        1) echo -e "\033[31m[$timestamp] $msg\033[0m" ;;
        2) echo -e "\033[32m[$timestamp] $msg\033[0m" ;;
        3) echo -e "\033[33m[$timestamp] $msg\033[0m" ;;
        6) echo -e "\033[36m[$timestamp] $msg\033[0m" ;;
        *) echo "[$timestamp] $msg" ;;
    esac
}

ensure_logs_dir() {
    if [[ ! -d "$LOGS_DIR" ]]; then
        mkdir -p "$LOGS_DIR"
        log "Created logs directory: $LOGS_DIR" 2
    fi
}

save_pids() {
    local server_pid="$1"
    local manager_pid="$2"
    ensure_logs_dir
    echo "${server_pid},${manager_pid}" > "$PID_FILE"
}

read_pids() {
    if [[ ! -f "$PID_FILE" ]]; then
        echo ""
        return
    fi
    cat "$PID_FILE"
}

stop_process() {
    local pid="$1"
    local label="$2"
    if [[ -z "$pid" ]] || [[ "$pid" -le 0 ]] 2>/dev/null; then return; fi
    if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null || true
        # 等待进程退出，最多 5 秒
        local waited=0
        while kill -0 "$pid" 2>/dev/null && [[ $waited -lt 50 ]]; do
            sleep 0.1
            waited=$((waited + 1))
        done
        # 如果还在运行，强制杀死
        if kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" 2>/dev/null || true
        fi
        log "$label stopped (PID: $pid)" 2
    fi
}

stop_all_services() {
    log "Stopping all services..." 3

    # 1. 优先通过 PID 文件停止
    local pids
    pids=$(read_pids)
    if [[ -n "$pids" ]]; then
        local server_pid="${pids%%,*}"
        local manager_pid="${pids##*,}"
        stop_process "$manager_pid" "Session Manager"
        stop_process "$server_pid" "Server"
        rm -f "$PID_FILE"
        sleep 0.5
    fi

    # 2. 兜底：通过命令行匹配残留 node 进程（排除自身）
    local stray_pids
    stray_pids=$(pgrep -f "ai-agent-server.js|session-manager.js" 2>/dev/null || true)
    for pid in $stray_pids; do
        if [[ "$pid" != "$$" ]]; then
            local cmdline
            cmdline=$(cat "/proc/$pid/cmdline" 2>/dev/null | tr '\0' ' ' || true)
            local label="Unknown"
            if [[ "$cmdline" == *"session-manager.js"* ]]; then
                label="Session Manager"
            elif [[ "$cmdline" == *"ai-agent-server.js"* ]]; then
                label="Server"
            fi
            stop_process "$pid" "$label (stray)"
        fi
    done

    # 3. 兜底：通过端口查找占用进程
    local port_pid
    port_pid=$(ss -tlnp 2>/dev/null | grep ":${PORT}" | grep -oP 'pid=\K[0-9]+' | head -1 || true)
    if [[ -z "$port_pid" ]]; then
        port_pid=$(lsof -ti :"$PORT" 2>/dev/null | head -1 || true)
    fi
    if [[ -n "$port_pid" ]]; then
        stop_process "$port_pid" "Server (port $PORT)"
    fi

    # 清理锁文件
    rm -f "$SERVER_LOCK_FILE" "$MANAGER_LOCK_FILE"

    sleep 0.5
    log "All services stopped" 2
}

wait_for_server_healthy() {
    local timeout="${1:-30}"
    local waited=0
    local interval=0.5

    log "Waiting for server to be ready (timeout: ${timeout}s)..." 3

    while [[ $waited -lt $((timeout * 10)) ]]; do
        # 检查端口是否在监听
        if ss -tlnp 2>/dev/null | grep -q ":${PORT}"; then
            log "Server is ready (port $PORT listening)" 2
            return 0
        fi
        # 备用：用 lsof 检查
        if lsof -ti :"$PORT" >/dev/null 2>&1; then
            log "Server is ready (port $PORT listening)" 2
            return 0
        fi

        sleep "$interval"
        waited=$((waited + 5))
    done

    log "Server ready check timeout after $timeout seconds" 1
    return 1
}

start_server() {
    log "Starting server..." 3

    if ! command -v node &>/dev/null; then
        log "ERROR: Node.js not found in PATH" 1
        exit 1
    fi

    local script_path="$SERVER_DIR/ai-agent-server.js"

    if [[ "$ENV" == "prod" ]]; then
        ensure_logs_dir
        nohup node "$script_path" >> "$SERVER_LOG_FILE" 2>> "$SERVER_ERR_FILE" &
        local pid=$!
        disown "$pid" 2>/dev/null || true
        log "Server started (PID: $pid, background mode), log: $SERVER_LOG_FILE" 2
    else
        # 开发环境：前台日志输出到终端
        node "$script_path" >> "$SERVER_LOG_FILE" 2>> "$SERVER_ERR_FILE" &
        local pid=$!
        log "Server started (PID: $pid, dev mode)" 2
    fi

    echo "$pid"
}

start_session_manager() {
    log "Starting Session Manager..." 3

    local script_path="$CLIENT_DIR/session-manager.js"

    if [[ "$ENV" == "prod" ]]; then
        ensure_logs_dir
        nohup node "$script_path" >> "$MANAGER_LOG_FILE" 2>> "$MANAGER_ERR_FILE" &
        local pid=$!
        disown "$pid" 2>/dev/null || true
        log "Session Manager started (PID: $pid, background mode), log: $MANAGER_LOG_FILE" 2
    else
        node "$script_path" >> "$MANAGER_LOG_FILE" 2>> "$MANAGER_ERR_FILE" &
        local pid=$!
        log "Session Manager started (PID: $pid, dev mode)" 2
    fi

    # 等待锁文件创建
    local waited=0
    while [[ ! -f "$MANAGER_LOCK_FILE" ]] && [[ $waited -lt 30 ]]; do
        sleep 0.1
        waited=$((waited + 1))
    done

    echo "$pid"
}

show_status() {
    echo ""
    echo -e "\033[36m========================================\033[0m"

    local pids
    pids=$(read_pids)
    local server_alive=false
    local manager_alive=false
    local server_pid=""
    local manager_pid=""

    if [[ -n "$pids" ]]; then
        server_pid="${pids%%,*}"
        manager_pid="${pids##*,}"
        kill -0 "$server_pid" 2>/dev/null && server_alive=true || true
        kill -0 "$manager_pid" 2>/dev/null && manager_alive=true || true
    fi

    echo -n "Environment: "
    if [[ "$ENV" == "prod" ]]; then
        echo -e "\033[32mPROD\033[0m"
    else
        echo -e "\033[33mDEV\033[0m"
    fi

    echo -n "Server:      "
    if $server_alive; then
        echo -e "\033[32mRunning (PID: $server_pid)\033[0m"
    else
        echo -e "\033[31mStopped\033[0m"
    fi

    echo -n "Session Mgr: "
    if $manager_alive; then
        echo -e "\033[32mRunning (PID: $manager_pid)\033[0m"
    else
        echo -e "\033[31mStopped\033[0m"
    fi

    echo ""
    echo -e "\033[36mAccess URLs:\033[0m"
    echo "  Server:  http://127.0.0.1:$PORT"
    echo "  Web App: http://localhost:$PORT/"
    echo ""

    if [[ "$ENV" == "prod" ]]; then
        echo -e "\033[36mLog Files:\033[0m"
        echo "  Server:  $SERVER_LOG_FILE"
        echo "  Manager: $MANAGER_LOG_FILE"
        echo ""
    fi
}

start_services() {
    stop_all_services
    sleep 1

    local server_pid
    server_pid=$(start_server)

    if ! wait_for_server_healthy 30; then
        log "Server failed to become healthy, aborting..." 1
        exit 1
    fi

    local manager_pid
    manager_pid=$(start_session_manager)

    save_pids "$server_pid" "$manager_pid"
    sleep 2
    show_status
}

# 主逻辑
echo ""
echo -e "\033[36m========================================\033[0m"
echo -e "\033[36mClaude Remote Control - Service Manager\033[0m"
echo -e "\033[36m========================================\033[0m"
echo ""
log "Action: $ACTION | Environment: $ENV" 6
echo ""

case "$ACTION" in
    stop)
        stop_all_services
        ;;
    start)
        stop_all_services
        sleep 1
        server_pid=$(start_server)
        if ! wait_for_server_healthy 30; then
            log "Server failed to become healthy, aborting..." 1
            exit 1
        fi
        manager_pid=$(start_session_manager)
        save_pids "$server_pid" "$manager_pid"
        sleep 2
        show_status
        ;;
    restart)
        start_services
        ;;
esac

echo ""
