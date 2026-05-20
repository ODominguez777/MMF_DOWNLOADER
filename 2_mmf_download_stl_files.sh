#!/bin/bash

# Legacy Step 2 entrypoint.
# Keeps backward compatibility while delegating to the hardened implementation.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENHANCED_SCRIPT="${SCRIPT_DIR}/mmf_download_stl_files_enhanced.sh"

if [[ ! -f "$ENHANCED_SCRIPT" ]]; then
    echo "Error: Enhanced Step 2 script not found: $ENHANCED_SCRIPT"
    exit 1
fi

echo "[INFO] Using hardened downloader: $(basename "$ENHANCED_SCRIPT")"
exec bash "$ENHANCED_SCRIPT" "$@"
