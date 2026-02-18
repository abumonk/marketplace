#!/usr/bin/env bash
# pipeline-status.sh - Read .agent/tasks/ and display formatted pipeline status
# Usage: ./pipeline-status.sh [tasks_dir]

set -euo pipefail

TASKS_DIR="${1:-.agent/tasks}"

# Colors
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

if [ ! -d "$TASKS_DIR" ]; then
  echo -e "${RED}Error: $TASKS_DIR not found. Run /task-init first.${NC}"
  exit 1
fi

# Parse frontmatter value from a file
parse_field() {
  local file="$1" field="$2"
  grep "^${field}:" "$file" 2>/dev/null | head -1 | sed "s/^${field}:[[:space:]]*//"
}

# Color a status string
color_status() {
  local status="$1"
  case "$status" in
    blocked*|error*|failed*)  echo -e "${RED}${status}${NC}" ;;
    in_progress*|fixing*)     echo -e "${YELLOW}${status}${NC}" ;;
    ready|passed)             echo -e "${CYAN}${status}${NC}" ;;
    completed|done)           echo -e "${GREEN}${status}${NC}" ;;
    *)                        echo "$status" ;;
  esac
}

# Check if stuck (>24h since last update)
is_stuck() {
  local updated="$1"
  if [ -z "$updated" ]; then return 1; fi
  local updated_epoch now_epoch diff_hours
  updated_epoch=$(date -d "$updated" +%s 2>/dev/null || echo 0)
  now_epoch=$(date +%s)
  diff_hours=$(( (now_epoch - updated_epoch) / 3600 ))
  [ "$diff_hours" -gt 24 ]
}

echo -e "${BOLD}Pipeline Status${NC}"
echo -e "${BOLD}$(printf '=%.0s' {1..60})${NC}"
echo ""

# Header
printf "%-10s %-30s %-15s %-14s %-12s\n" "ID" "Title" "Status" "Assignee" "Updated"
printf "%-10s %-30s %-15s %-14s %-12s\n" "----------" "------------------------------" "---------------" "--------------" "------------"

# Process each task file (skip archive/)
found=0
for file in "$TASKS_DIR"/*.md; do
  [ -f "$file" ] || continue

  id=$(parse_field "$file" "id")
  title=$(parse_field "$file" "title")
  status=$(parse_field "$file" "status")
  assignee=$(parse_field "$file" "assignee")
  updated=$(parse_field "$file" "updated")
  stage=$(parse_field "$file" "stage")

  # Truncate title
  if [ ${#title} -gt 28 ]; then
    title="${title:0:25}..."
  fi

  # Mark stuck tasks
  stuck=""
  if [ "$status" = "in_progress" ] || [ "$status" = "blocked" ]; then
    if is_stuck "$updated"; then
      stuck=" [STUCK]"
    fi
  fi

  display_status="${status}${stuck}"

  printf "%-10s %-30s " "${id:-—}" "${title:-—}"
  color_status "$display_status"
  printf "%-14s %-12s\n" "${assignee:-—}" "${updated:-—}"
  found=$((found + 1))
done

if [ "$found" -eq 0 ]; then
  echo -e "${YELLOW}No tasks found.${NC}"
fi

echo ""
echo -e "${BOLD}Total: ${found} tasks${NC}"
