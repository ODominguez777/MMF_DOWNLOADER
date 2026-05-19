#!/bin/bash

# MyMiniFactory - Mass ZIP Extraction Script (Cross-platform)
# Extracts all ZIP files recursively from a stl_files directory.
# Works on macOS and Linux. On Windows, use 3_extract_all_zips.ps1.

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

BASE_PATH="${MMF_BASE_PATH:-PATH/TO/YOUR/downloads/stl_files}"
EXTRACT_IN_PLACE_RAW="${MMF_EXTRACT_IN_PLACE:-true}"

EXTRACT_IN_PLACE="false"
if [[ "$EXTRACT_IN_PLACE_RAW" =~ ^([Tt][Rr][Uu][Ee]|1|[Yy][Ee][Ss])$ ]]; then
    EXTRACT_IN_PLACE="true"
fi

validate_zip_archive_safe() {
    local archive_path="$1"
    local destination_root="$2"

    if ! command -v unzip >/dev/null 2>&1; then
        echo -e "${RED}ERROR: unzip is required for safe zip validation.${NC}" >&2
        return 1
    fi

    local root_full
    root_full="$(cd "$destination_root" && pwd -P)"

    local entry
    while IFS= read -r entry; do
        [[ -z "$entry" ]] && continue
        [[ "$entry" == */ ]] && continue
        [[ "$entry" == *..* ]] && return 1
        [[ "$entry" == /* ]] && return 1

        local normalized_entry="${entry//\\//}"
        local destination_file="${root_full}/${normalized_entry}"

        if [[ "$destination_file" != "$root_full" && "$destination_file" != "$root_full"/* ]]; then
            return 1
        fi
    done < <(unzip -Z1 "$archive_path")

    return 0
}

extract_zip() {
    local archive_path="$1"
    local destination_path="$2"

    if ! validate_zip_archive_safe "$archive_path" "$destination_path"; then
        echo -e "${RED}Blocked unsafe zip archive: $(basename "$archive_path")${NC}" >&2
        return 1
    fi

    if command -v unzip >/dev/null 2>&1; then
        unzip -o -q "$archive_path" -d "$destination_path" >/dev/null 2>&1
        return $?
    fi

    if command -v bsdtar >/dev/null 2>&1; then
        bsdtar -xf "$archive_path" -C "$destination_path" >/dev/null 2>&1
        return $?
    fi

    if command -v tar >/dev/null 2>&1; then
        tar -xf "$archive_path" -C "$destination_path" >/dev/null 2>&1
        return $?
    fi

    return 127
}

echo -e "${BLUE}MyMiniFactory ZIP Extraction Tool (Cross-platform)${NC}"
echo -e "${BLUE}===============================================${NC}"
echo ""

if [[ ! -d "$BASE_PATH" ]]; then
    echo -e "${RED}ERROR: Base path does not exist: $BASE_PATH${NC}"
    echo "Update MMF_BASE_PATH or pass a valid path from the desktop app helper."
    exit 1
fi

if ! command -v unzip >/dev/null 2>&1 && ! command -v bsdtar >/dev/null 2>&1 && ! command -v tar >/dev/null 2>&1; then
    echo -e "${RED}ERROR: No archive extractor found (unzip, bsdtar, or tar).${NC}"
    exit 1
fi

zip_count=$(find "$BASE_PATH" -type f -name "*.zip" | wc -l | tr -d ' ')
if [[ "$zip_count" -eq 0 ]]; then
    echo -e "${YELLOW}No ZIP files found in $BASE_PATH${NC}"
    exit 0
fi

echo -e "${GREEN}Found $zip_count ZIP files to extract${NC}"
echo -e "${BLUE}Extraction mode: $EXTRACT_IN_PLACE${NC}"
echo ""

current=0
successful=0
failed=0

while IFS= read -r -d '' zip_file; do
    current=$((current + 1))
    percent=$((current * 100 / zip_count))

    zip_name="$(basename "$zip_file")"
    zip_dir="$(dirname "$zip_file")"

    if [[ "$EXTRACT_IN_PLACE" == "true" ]]; then
        destination="$zip_dir"
    else
        base_name="${zip_name%.zip}"
        destination="$zip_dir/${base_name}_extracted"
        mkdir -p "$destination"
    fi

    echo -e "${BLUE}[$current/$zip_count - ${percent}%] Extracting: $zip_name${NC}"

    if extract_zip "$zip_file" "$destination"; then
        echo -e "  ${GREEN}[OK] Extracted to: $destination${NC}"
        successful=$((successful + 1))
    else
        echo -e "  ${RED}[FAIL] Could not extract: $zip_name${NC}"
        failed=$((failed + 1))
    fi
done < <(find "$BASE_PATH" -type f -name "*.zip" -print0)

echo ""
echo -e "${GREEN}Extraction Complete${NC}"
echo -e "${GREEN}===================${NC}"
echo -e "${GREEN}Successfully extracted: $successful${NC}"
if [[ "$failed" -gt 0 ]]; then
    echo -e "${RED}Failed: $failed${NC}"
fi
