#!/usr/bin/env bash
# Run ON the VPS as root (or with sudo).
# Usage:
#   sudo bash deploy/nginx/apply-sse-fix.sh
# Optional:
#   DISPLAY_PUBLIC_ID=your_public_id sudo -E bash deploy/nginx/apply-sse-fix.sh

set -euo pipefail

SITE_HINT="${SITE_HINT:-qmsnexuptech}"
SNIPPET_SRC="$(cd "$(dirname "$0")" && pwd)/sse-api-locations.conf"
SNIPPET_DST="/etc/nginx/snippets/qms-sse-api.conf"
BACKUP_DIR="/root/nginx-backup-$(date +%Y%m%d%H%M%S)"

if [[ ! -f "$SNIPPET_SRC" ]]; then
  echo "Missing snippet: $SNIPPET_SRC" >&2
  exit 1
fi

echo "==> Backing up nginx config to $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"
cp -a /etc/nginx "$BACKUP_DIR/"

echo "==> Installing SSE snippet at $SNIPPET_DST"
mkdir -p /etc/nginx/snippets
cp "$SNIPPET_SRC" "$SNIPPET_DST"

# Find active site file that mentions the domain/hint
SITE_FILE="$(grep -RIl --include='*' "$SITE_HINT" /etc/nginx/sites-enabled 2>/dev/null | head -n1 || true)"
if [[ -z "${SITE_FILE}" ]]; then
  SITE_FILE="$(grep -RIl --include='*' "$SITE_HINT" /etc/nginx/conf.d 2>/dev/null | head -n1 || true)"
fi
if [[ -z "${SITE_FILE}" ]]; then
  echo "Could not auto-detect site file. Set SITE_FILE=/path/to/config and re-run." >&2
  echo "Current enabled sites:" >&2
  ls -la /etc/nginx/sites-enabled || true
  exit 1
fi

echo "==> Detected site file: $SITE_FILE"

if grep -q "qms-sse-api.conf" "$SITE_FILE"; then
  echo "==> Snippet already included in $SITE_FILE"
else
  # Insert include inside the first HTTPS server block (listen 443), before first location /
  python3 - <<'PY' "$SITE_FILE"
import sys
from pathlib import Path
path = Path(sys.argv[1])
text = path.read_text()
needle = "include /etc/nginx/snippets/qms-sse-api.conf;"
if needle in text:
    print("already present")
    raise SystemExit(0)
lines = text.splitlines(keepends=True)
out = []
inserted = False
in_443 = False
brace_depth = 0
for i, line in enumerate(lines):
    out.append(line)
    if not inserted and "listen" in line and "443" in line:
        in_443 = True
    if in_443 and not inserted and line.lstrip().startswith("location /"):
        # insert immediately before the catch-all location /
        out.pop()  # remove location line temporarily
        indent = line[: len(line) - len(line.lstrip())]
        out.append(f"{indent}# QMS SSE / API direct to NestJS\n")
        out.append(f"{indent}include /etc/nginx/snippets/qms-sse-api.conf;\n")
        out.append(f"\n")
        out.append(line)
        inserted = True
if not inserted:
    # fallback: append include before last closing brace of file
    for i in range(len(out) - 1, -1, -1):
        if out[i].strip() == "}":
            out.insert(i, "    include /etc/nginx/snippets/qms-sse-api.conf;\n")
            inserted = True
            break
if not inserted:
    raise SystemExit("Failed to insert include directive automatically")
path.write_text("".join(out))
print("inserted include")
PY
fi

echo "==> Testing nginx config"
nginx -t

echo "==> Reloading nginx"
systemctl reload nginx

echo "==> Current buffering-related directives (filtered):"
nginx -T 2>/dev/null | grep -E "proxy_buffering|proxy_cache|gzip|qms-sse|public/displays|proxy_read_timeout|proxy_pass" || true

echo
echo "==> Local API SSE probe (needs a real DISPLAY_PUBLIC_ID)"
if [[ -n "${DISPLAY_PUBLIC_ID:-}" ]]; then
  echo "--- localhost:4000 (bypass nginx) ---"
  timeout 8 curl -N -sS -D - "http://127.0.0.1:4000/public/displays/${DISPLAY_PUBLIC_ID}/events" | head -n 40 || true
  echo
  echo "--- via public https (through nginx) ---"
  timeout 8 curl -N -sS -D - "https://qmsnexuptech.online/api/public/displays/${DISPLAY_PUBLIC_ID}/events" | head -n 40 || true
else
  echo "Set DISPLAY_PUBLIC_ID to run curl streaming comparison."
fi

echo
echo "Done. If frames stream live through https, open a display page and call a token — UI should update without refresh."
