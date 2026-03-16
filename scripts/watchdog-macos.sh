#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${CHRONOSNAP_APP_NAME:-Framr Studio}"
APP_PATH="${CHRONOSNAP_APP_PATH:-/Applications/Framr Studio.app}"
CHECK_INTERVAL_SECONDS="${CHRONOSNAP_WATCHDOG_INTERVAL_SECONDS:-3}"

while true; do
  if ! pgrep -if "$APP_NAME" >/dev/null 2>&1; then
    if [[ -d "$APP_PATH" ]]; then
      open "$APP_PATH" >/dev/null 2>&1 || true
    else
      open -a "$APP_NAME" >/dev/null 2>&1 || true
    fi
  fi

  sleep "$CHECK_INTERVAL_SECONDS"
done
