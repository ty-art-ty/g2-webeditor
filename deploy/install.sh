#!/usr/bin/env bash
# Auf dem Pi als root ausführen. Erwartet Build unter backend/build/install/g2web-backend.
set -euo pipefail
cd "$(dirname "$0")/.."

id -u g2web &>/dev/null || useradd --system --no-create-home --groups plugdev g2web

cp deploy/99-clavia-g2.rules /etc/udev/rules.d/
udevadm control --reload-rules && udevadm trigger

mkdir -p /opt/g2web
cp -r backend/build/install/g2web-backend/. /opt/g2web/
chown -R g2web: /opt/g2web

cp deploy/g2web.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now g2web

echo "g2web läuft: http://$(hostname).local:8080"
