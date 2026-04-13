#!/usr/bin/env bash
# Run on the MeshCentral server (e.g. Hetzner VPS). Verifies installed plugin version,
# Famous Recon module presence, runtime integration settings (secrets masked), and
# suggests log correlation commands after a manual device refresh.
#
# Usage:
#   export MESHCENTRAL_DATA=/opt/meshcentral/meshcentral-data   # optional override
#   bash scripts/verify-famous-recon-deploy.sh

set -euo pipefail

DATA_ROOT="${MESHCENTRAL_DATA:-/opt/meshcentral/meshcentral-data}"
PLUGIN_SHORT="centralreconperipherals"

echo "=== CentralRecon Peripherals — deploy verification ==="
echo "Data root: ${DATA_ROOT}"
echo ""

if [[ ! -d "${DATA_ROOT}" ]]; then
  echo "ERROR: data root not found. Set MESHCENTRAL_DATA to your meshcentral-data path."
  exit 1
fi

echo "--- 1) Plugin source copies (centralreconperipherals.js) ---"
mapfile -t JS_PATHS < <(find "${DATA_ROOT}" -type f -name 'centralreconperipherals.js' 2>/dev/null | head -20 || true)
if [[ ${#JS_PATHS[@]} -eq 0 ]]; then
  echo "No centralreconperipherals.js found under ${DATA_ROOT}."
else
  for f in "${JS_PATHS[@]}"; do
    dir=$(dirname "${f}")
    echo "  ${f}"
    if [[ -f "${dir}/config.json" ]] && grep -q '"version"' "${dir}/config.json" 2>/dev/null; then
      echo "    plugin metadata version: $(grep -m1 '"version"' "${dir}/config.json" | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')"
    fi
    if [[ -f "${dir}/lib/famous-recon.js" ]]; then
      echo "    lib/famous-recon.js: present"
    else
      echo "    lib/famous-recon.js: MISSING (pre–0.1.11 / incomplete install)"
    fi
    if grep -q 'famous-recon' "${f}" 2>/dev/null; then
      echo "    main JS requires famous-recon: yes"
    else
      echo "    main JS requires famous-recon: no"
    fi
  done
fi
echo ""

echo "--- 2) Runtime saved config (${PLUGIN_SHORT}/config.json) ---"
RUNTIME_CFG="${DATA_ROOT}/${PLUGIN_SHORT}/config.json"
if [[ ! -f "${RUNTIME_CFG}" ]]; then
  echo "Not found: ${RUNTIME_CFG}"
  echo "(Plugin may never have saved settings, or datapath differs.)"
else
  echo "File: ${RUNTIME_CFG}"
  if command -v jq >/dev/null 2>&1; then
    jq -r '
      (.integrations.famousRecon // {})
      | "  enabled: \(.enabled // false)\n"
        + "  endpointUrl: \(.endpointUrl // "")\n"
        + "  apiKey: " + (if ((.apiKey // "")|tostring|length) > 8 then ((.apiKey // "")|tostring|.[0:4] + "***" + .[-4:]) else "***" end) + "\n"
        + "  directDbDeprecated: " + (if (((.supabaseUrl // "")|tostring|length) > 0 or ((.supabaseAnonKey // "")|tostring|length) > 0) then "present" else "absent" end) + "\n"
        + "  deviceType: \(.deviceType // "")\n"
        + "  exportOnStatusScans: \(.exportOnStatusScans // false)\n"
        + "  exportOnFullScans: \(.exportOnFullScans // false)\n"
        + "  requestTimeoutMs: \(.requestTimeoutMs // "")"
    ' "${RUNTIME_CFG}" 2>/dev/null || echo "  (jq parse failed — inspect file manually)"
  else
    echo "  Install jq to print masked integration fields, or open the file in an editor."
  fi
fi
echo ""

echo "--- 3) Correlate logs after DEBMAIN2 (or any device) full refresh ---"
echo "MeshCentral plugin debug lines use prefix: ${PLUGIN_SHORT}:"
echo "  Famous Recon export attempt:"
echo "  Famous Recon export ok:"
echo "  Famous Recon export failed:"
echo "  Famous Recon export skipped:"
echo ""
echo "Search recent MeshCentral output (adjust paths for your install):"
echo "  journalctl -u meshcentral --since \"10 min ago\" 2>/dev/null | grep -E '${PLUGIN_SHORT}|Famous Recon' || true"
echo "  grep -E '${PLUGIN_SHORT}|Famous Recon' \"${DATA_ROOT}\"/mesherrors.txt 2>/dev/null | tail -50 || true"
echo ""
echo "On FamousRecon / reverse proxy: filter access logs for your ingest path at the same timestamp."
echo "=== Done ==="
