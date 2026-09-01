#!/usr/bin/env bash
set -euo pipefail

REPO=/opt/elankav/orchestrator
UNIT_SRC="$REPO/deploy/systemd/elankav-owner-ops-supervisor.service"
UNIT_DST=/etc/systemd/system/elankav-owner-ops-supervisor.service
STATE_DIR=/var/lib/elankav-owner-ops

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: ejecutar como root" >&2
  exit 1
fi

if [ ! -f "$UNIT_SRC" ]; then
  echo "ERROR: falta $UNIT_SRC" >&2
  exit 2
fi

install -d -m 0700 "$STATE_DIR" "$STATE_DIR/requests" "$STATE_DIR/results" "$STATE_DIR/processing"
install -m 0644 "$UNIT_SRC" "$UNIT_DST"
chmod 0755 "$REPO/bin/owner-ops-supervisor.js"

systemctl daemon-reload
systemctl enable --now elankav-owner-ops-supervisor.service
sleep 2
systemctl is-active --quiet elankav-owner-ops-supervisor.service

echo "OWNER_OPS_SUPERVISOR_ACTIVE"
