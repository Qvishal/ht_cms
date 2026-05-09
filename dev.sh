#!/usr/bin/env bash
set -uo pipefail

# ─── Colors ────────────────────────────────────────────────────────────────────
RESET="\033[0m"
BOLD="\033[1m"
CYAN="\033[0;36m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
MAGENTA="\033[0;35m"
RED="\033[0;31m"

# ─── Resolve script root ───────────────────────────────────────────────────────
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ─── PID tracking ─────────────────────────────────────────────────────────────
PIDS=()

# ─── Graceful shutdown ─────────────────────────────────────────────────────────
cleanup() {
  echo -e "\n${BOLD}${RED}⏹  Shutting down all services...${RESET}"
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  echo -e "${YELLOW}🐳 Stopping Docker containers...${RESET}"
  (cd "$ROOT/database" && docker-compose down) 2>/dev/null || true
  echo -e "${GREEN}✅ All services stopped.${RESET}"
  exit 0
}
trap cleanup SIGINT SIGTERM

# ─── Prefixed log stream ───────────────────────────────────────────────────────
# Usage: stream_prefix <color> <label> <command> [args...]
stream_prefix() {
  local color="$1"; local label="$2"; shift 2
  "$@" 2>&1 | while IFS= read -r line; do
    echo -e "${color}${BOLD}[${label}]${RESET} $line"
  done &
  PIDS+=($!)
}

# ─── Banner ────────────────────────────────────────────────────────────────────
echo -e "${BOLD}${CYAN}"
echo "  ██╗  ██╗████████╗      ██████╗███╗   ███╗███████╗"
echo "  ██║  ██║╚══██╔══╝     ██╔════╝████╗ ████║██╔════╝"
echo "  ███████║   ██║        ██║     ██╔████╔██║███████╗"
echo "  ██╔══██║   ██║        ██║     ██║╚██╔╝██║╚════██║"
echo "  ██║  ██║   ██║        ╚██████╗██║ ╚═╝ ██║███████║"
echo "  ╚═╝  ╚═╝   ╚═╝         ╚═════╝╚═╝     ╚═╝╚══════╝"
echo -e "${RESET}"
echo -e "${BOLD}Starting all services...${RESET}\n"

# ─── Wait for MySQL to be truly ready (not just port-open) ────────────────────
wait_for_mysql() {
  local timeout="${1:-90}" elapsed=0
  echo -e "${YELLOW}⏳ Waiting for MySQL to accept connections...${RESET}"
  until docker exec ht_cms_mysql mysqladmin ping -h 127.0.0.1 -u root -pht_cms_root --silent 2>/dev/null; do
    if (( elapsed >= timeout )); then
      echo -e "${RED}❌ Timed out waiting for MySQL after ${timeout}s${RESET}"
      return 1
    fi
    sleep 2
    (( elapsed += 2 ))
  done
  echo -e "${GREEN}✅ MySQL is ready (${elapsed}s)${RESET}"
}

# ─── Wait for PostgreSQL to be truly ready ─────────────────────────────────────
wait_for_postgres() {
  local timeout="${1:-90}" elapsed=0
  echo -e "${YELLOW}⏳ Waiting for PostgreSQL to accept connections...${RESET}"
  until docker exec ht_cms_postgres pg_isready -U ht_cms -d ht_cms -q 2>/dev/null; do
    if (( elapsed >= timeout )); then
      echo -e "${RED}❌ Timed out waiting for PostgreSQL after ${timeout}s${RESET}"
      return 1
    fi
    sleep 1
    (( elapsed++ ))
  done
  echo -e "${GREEN}✅ PostgreSQL is ready (${elapsed}s)${RESET}"
}

# ─── 1. Docker (databases) ─────────────────────────────────────────────────────
echo -e "${YELLOW}🐳 Starting Docker containers (MySQL, PostgreSQL, Redis)...${RESET}"
(cd "$ROOT/database" && docker-compose up -d) 2>&1
echo -e "${GREEN}✅ Docker containers started${RESET}\n"

# Wait for databases to be truly ready before starting the backend
wait_for_mysql 90
wait_for_postgres 90
echo ""

# ─── 2. Backend (Bun) ─────────────────────────────────────────────────────────
echo -e "${MAGENTA}🚀 Starting Backend on :4000...${RESET}"
stream_prefix "$MAGENTA" "backend" bash -c "cd '$ROOT/backend' && bun run dev"

# ─── 3. Frontend (Next.js) ────────────────────────────────────────────────────
echo -e "${CYAN}🌐 Starting Frontend on :3000...${RESET}"
stream_prefix "$CYAN" "frontend" bash -c "cd '$ROOT/frontend' && npm run dev"

echo -e "\n${BOLD}${GREEN}✅ All services running!${RESET}"
echo -e "   ${CYAN}Frontend${RESET}  → http://localhost:3000"
echo -e "   ${MAGENTA}Backend${RESET}   → http://localhost:4000"
echo -e "   ${YELLOW}MySQL${RESET}     → localhost:3307"
echo -e "   ${YELLOW}PostgreSQL${RESET}→ localhost:5432"
echo -e "   ${YELLOW}Redis${RESET}     → localhost:6379"
echo -e "\n${BOLD}Press Ctrl+C to stop all services.${RESET}\n"

# ─── Wait for all background processes ────────────────────────────────────────
wait
