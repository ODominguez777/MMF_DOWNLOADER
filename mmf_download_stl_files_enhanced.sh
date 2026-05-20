#!/bin/bash

# Bulk Downloader — STL/ZIP files, enhanced (Step 2)
# Downloads actual 3D printable files from a list of model IDs
# This is STEP 2 - run AFTER the metadata downloader creates JSON files
# 
# NEW in Enhanced Edition:
# - Cookie validation before starting
# - Automatic HTML error page detection
# - Test mode to verify setup before bulk download
# - Better error messages with troubleshooting steps
# - Stops on systematic errors (e.g., all downloads failing)
# 
# Prerequisites:
# 1. JSON metadata files from Step 1 (model_*.json files)
# 2. Valid MyMiniFactory session cookie
# 3. jq installed (JSON parser) - download from https://github.com/stedolan/jq/releases
#
# Usage:
# 1. Run metadata downloader first (Step 1)
# 2. Update COOKIE variable below with your session cookie
# 3. Place jq or jq.exe in same directory
# 4. Run in test mode first: bash download_stl_files.sh --test
# 5. If test passes, run full: bash download_stl_files.sh

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ============================================================================
# CONFIGURATION
# ============================================================================
# UPDATE THIS: Get your cookie from browser developer tools
# 
# HOW TO GET YOUR COOKIE (IMPORTANT - READ CAREFULLY):
# 1. Open MyMiniFactory in your browser and log in
# 2. Navigate to any model you own
# 3. Click download button for any file (Resin, FDM, etc.)
# 4. Open Developer Tools (F12)
# 5. Go to Network tab
# 6. Find the request to "myminifactory.com/download/XXXXX?archive_id=XXXXX"
# 7. Click on that request
# 8. Scroll to "Request Headers" section
# 9. Find the "Cookie:" header
# 10. Copy ONLY the value (everything after "Cookie: ")
# 11. Paste below between the single quotes
#
# Your cookie MUST include these parts:
# - PHPSESSID=...
# - cf_clearance=... (Cloudflare token - CRITICAL)
# - Various _ga and _pk tracking cookies
#
# If you're missing cf_clearance, you'll get "enable Javascript" errors
COOKIE="${MMF_COOKIE:-REPLACE_WITH_YOUR_ACTUAL_COOKIE_STRING}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# ============================================================================

# Configuration
TEST_MODE=false
MAX_CONSECUTIVE_FAILURES=3  # Stop if this many downloads fail in a row
STL_FILE_DELAY_SEC="${MMF_STL_FILE_DELAY_SEC:-5}"
IMAGE_DELAY_SEC="${MMF_IMAGE_DELAY_SEC:-3}"

# Parse command line arguments
if [[ "$1" == "--test" ]]; then
    TEST_MODE=true
fi

# Function to validate cookie format
validate_cookie() {
    if [[ "$COOKIE" == "REPLACE_WITH_YOUR_ACTUAL_COOKIE_STRING" ]]; then
        echo -e "${RED}ERROR: Cookie not configured!${NC}"
        echo "Please update the COOKIE variable in this script with your actual session cookie."
        echo "See the HOW TO GET YOUR COOKIE instructions in the script."
        return 1
    fi
    
    if [[ ! "$COOKIE" =~ PHPSESSID ]]; then
        echo -e "${YELLOW}WARNING: Cookie missing PHPSESSID - this may not work${NC}"
    fi
    
    if [[ ! "$COOKIE" =~ cf_clearance ]]; then
        echo -e "${YELLOW}WARNING: Cookie missing cf_clearance (Cloudflare token)${NC}"
        echo "This is the most common cause of 'enable Javascript' errors."
        echo "Make sure you copied the cookie from a DOWNLOAD request, not a page view."
        return 1
    fi
    
    echo -e "${GREEN}[OK] Cookie format looks valid${NC}"
    return 0
}

# Function to check if downloaded file is an HTML error page
is_html_error() {
    local file="$1"
    
    if [[ ! -f "$file" ]] || [[ ! -s "$file" ]]; then
        return 1
    fi
    
    # Check if file starts with HTML tags or common error messages
    if head -20 "$file" | grep -qi "<!DOCTYPE\|<html\|enable javascript\|cloudflare"; then
        return 0
    fi
    
    return 1
}

# Function to display error page content
show_error_content() {
    local file="$1"
    echo -e "${CYAN}Error page content (first 20 lines):${NC}"
    head -20 "$file" | sed 's/^/  /'
}

get_file_size() {
    local file="$1"
    stat -c%s "$file" 2>/dev/null || stat -f%z "$file" 2>/dev/null || echo "unknown"
}

sanitize_filename() {
    local original_name="$1"
    local sanitized_name
    sanitized_name=$(printf "%s" "$original_name" | tr '/\\:*?"<>|' '_')
    sanitized_name=$(printf "%s" "$sanitized_name" | tr -d '\r\n')
    sanitized_name="${sanitized_name## }"
    sanitized_name="${sanitized_name%% }"

    if [[ -z "$sanitized_name" ]]; then
        sanitized_name="unnamed_file"
    fi

    printf "%s" "$sanitized_name"
}

FOLDER_NAMING_FORMAT="${MMF_NAMING_FORMAT:-ID_NAME}"
MAX_FOLDER_NAME_LENGTH="${MMF_MAX_NAME_LENGTH:-80}"

if [[ "$FOLDER_NAMING_FORMAT" != "NAME_ONLY" ]]; then
    FOLDER_NAMING_FORMAT="ID_NAME"
fi

if [[ ! "$MAX_FOLDER_NAME_LENGTH" =~ ^[0-9]+$ ]]; then
    MAX_FOLDER_NAME_LENGTH=80
fi

if [[ "$MAX_FOLDER_NAME_LENGTH" -lt 10 ]]; then
    MAX_FOLDER_NAME_LENGTH=10
elif [[ "$MAX_FOLDER_NAME_LENGTH" -gt 160 ]]; then
    MAX_FOLDER_NAME_LENGTH=160
fi

sanitize_folder_name() {
    local name="$1"
    local cleaned=""

    cleaned="$(printf "%s" "$name" | tr -d '\r\n')"
    cleaned="$(printf "%s" "$cleaned" | sed -E 's/[<>:"/\\|?*]/_/g; s/[[:space:]]+/ /g; s/ /_/g; s/_+/_/g; s/^_+//; s/_+$//')"

    if [[ -z "$cleaned" ]]; then
        cleaned="unnamed_model"
    fi

    if [[ ${#cleaned} -gt $MAX_FOLDER_NAME_LENGTH ]]; then
        cleaned="${cleaned:0:$MAX_FOLDER_NAME_LENGTH}"
        cleaned="$(printf "%s" "$cleaned" | sed -E 's/_+$//')"
    fi

    if [[ -z "$cleaned" ]]; then
        cleaned="unnamed_model"
    fi

    printf "%s" "$cleaned"
}

build_model_folder_name() {
    local source_json="$1"
    local model_id="$2"
    local model_name=""
    local clean_name=""

    model_name=$($JQ_CMD -r '.name // ""' "$source_json" 2>/dev/null | tr -d '\r' | xargs)
    clean_name=$(sanitize_folder_name "$model_name")

    if [[ "$FOLDER_NAMING_FORMAT" == "NAME_ONLY" ]]; then
        printf '%s' "$clean_name"
        return
    fi

    printf '%s_%s' "$model_id" "$clean_name"
}

unique_model_dir_name() {
    local desired_name="$1"
    local model_id="$2"
    local candidate="$desired_name"

    if [[ ! -e "$candidate" ]]; then
        printf '%s' "$candidate"
        return
    fi

    local suffix=1
    while [[ -e "${desired_name}_${suffix}" ]]; do
        suffix=$((suffix + 1))
    done

    printf '%s' "${desired_name}_${suffix}"
}

resolve_model_dir() {
    local model_id="$1"
    local json_file="$2"
    local preferred=""
    local legacy="model_${model_id}"

    preferred=$(build_model_folder_name "$json_file" "$model_id")

    if [[ -d "$preferred" ]]; then
        printf '%s' "$preferred"
        return
    fi

    if [[ -d "$legacy" ]]; then
        printf '%s' "$legacy"
        return
    fi

    preferred=$(unique_model_dir_name "$preferred" "$model_id")
    printf '%s' "$preferred"
}

unique_output_path() {
    local base_dir="$1"
    local target_name="$2"
    local candidate_path="${base_dir}/${target_name}"

    if [[ ! -e "$candidate_path" ]]; then
        printf "%s" "$candidate_path"
        return
    fi

    local suffix=1
    local name_without_ext="$target_name"
    local extension=""

    if [[ "$target_name" == *.* ]]; then
        name_without_ext="${target_name%.*}"
        extension=".${target_name##*.}"
    fi

    while true; do
        candidate_path="${base_dir}/${name_without_ext}_${suffix}${extension}"
        if [[ ! -e "$candidate_path" ]]; then
            printf "%s" "$candidate_path"
            return
        fi
        suffix=$((suffix + 1))
    done
}

get_model_archive_basename() {
    local source_json="$1"
    local model_id="$2"
    local model_name=""
    local archive_base=""

    model_name=$($JQ_CMD -r '.name // ""' "$source_json" 2>/dev/null | tr -d '\r' | xargs)
    archive_base=$(sanitize_filename "$model_name")

    if [[ -z "$archive_base" || "$archive_base" == "null" ]]; then
        archive_base="model_${model_id}_assets"
    fi

    printf "%s" "$archive_base"
}

is_valid_archive_file() {
    local file_path="$1"

    if [[ ! -f "$file_path" ]] || [[ ! -s "$file_path" ]]; then
        return 1
    fi

    if is_html_error "$file_path"; then
        return 1
    fi

    return 0
}

find_existing_assets_archive() {
    local model_dir="$1"
    local archive_base="$2"
    local candidate=""

    if [[ ! -d "$model_dir" ]]; then
        return 1
    fi

    candidate="${model_dir}/${archive_base}.zip"
    if is_valid_archive_file "$candidate"; then
        printf "%s" "$candidate"
        return 0
    fi

    shopt -s nullglob
    for candidate in "${model_dir}/${archive_base}"*.zip; do
        if is_valid_archive_file "$candidate"; then
            shopt -u nullglob
            printf "%s" "$candidate"
            return 0
        fi
    done
    shopt -u nullglob

    return 1
}

model_assets_already_archived() {
    local model_dir="$1"
    local source_json="$2"
    local model_id="$3"
    local archive_base=""

    archive_base=$(get_model_archive_basename "$source_json" "$model_id")
    find_existing_assets_archive "$model_dir" "$archive_base" >/dev/null
}

write_compact_model_json() {
    local source_json="$1"
    local model_dir="$2"
    local model_id="$3"
    local output_json="${model_dir}/model_${model_id}.json"

    if $JQ_CMD '{
        name: (.name // ""),
        description: (.description // ""),
        tags: (
            if .tags == null then []
            elif (.tags | type) == "array" then .tags
            else [ .tags ]
            end
        ),
        price: (
            if .price == null or .price == "" then 5
            elif (.price | type) == "number" then .price
            elif (.price | type) == "string" then ((.price | tonumber?) // 5)
            elif (.price | type) == "object" then (
                if .price.value == null or .price.value == "" then 5
                elif (.price.value | type) == "number" then .price.value
                elif (.price.value | type) == "string" then ((.price.value | tonumber?) // 5)
                else 5
                end
            )
            else 5
            end
        )
    }' "$source_json" > "$output_json"; then
        echo -e "  ${GREEN}[OK] Wrote compact JSON: model_${model_id}.json${NC}"
        return 0
    fi

    echo -e "  ${RED}[FAIL] Failed to build compact JSON for model $model_id${NC}"
    printf '{"name":"","description":"","tags":[],"price":5}\n' > "$output_json"
    return 1
}

download_model_images() {
    local source_json="$1"
    local model_dir="$2"

    local image_data
    image_data=$($JQ_CMD -r '.images[]? | "\((.is_primary // false) | tostring)|\(.original.url // "")"' "$source_json" 2>/dev/null)

    if [[ -z "$image_data" ]]; then
        echo -e "  ${YELLOW}! No images with original URL found${NC}"
        return 0
    fi

    local images_dir="${model_dir}/images"
    mkdir -p "$images_dir"

    local image_index=0

    while IFS='|' read -r is_primary image_url; do
        if [[ -z "$image_url" ]]; then
            continue
        fi

        image_index=$((image_index + 1))
        total_downloads=$((total_downloads + 1))

        image_url=$(echo "$image_url" | tr -d '\r' | xargs)
        local url_without_query="${image_url%%\?*}"
        local original_name
        original_name=$(basename "$url_without_query")

        if [[ -z "$original_name" ]]; then
            original_name="image_${image_index}.bin"
        fi

        local target_name
        if [[ "$is_primary" == "true" ]]; then
            local extension=""
            if [[ "$original_name" == *.* ]]; then
                extension=".${original_name##*.}"
            fi
            target_name="thumbnail_image${extension}"
        else
            target_name="$original_name"
        fi

        target_name=$(sanitize_filename "$target_name")
        local canonical_image_path="${images_dir}/${target_name}"

        if [[ -f "$canonical_image_path" ]] && [[ -s "$canonical_image_path" ]] && ! is_html_error "$canonical_image_path"; then
            local existing_image_size
            existing_image_size=$(get_file_size "$canonical_image_path")
            echo -e "  ${GREEN}[SKIP] Image already downloaded: $(basename "$canonical_image_path") (${existing_image_size} bytes)${NC}"
            successful_downloads=$((successful_downloads + 1))
            continue
        fi

        if [[ -e "$canonical_image_path" ]]; then
            rm -f "$canonical_image_path"
        fi

        local output_path
        output_path=$(unique_output_path "$images_dir" "$target_name")

        echo -e "  ${YELLOW}Downloading image: $(basename "$output_path")${NC}"

        curl --silent -L \
            -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0" \
            -H "Accept: image/*,*/*;q=0.8" \
            -H "Cookie: $COOKIE" \
            --compressed \
            "$image_url" \
            -o "$output_path"

        if [[ -f "$output_path" ]] && [[ -s "$output_path" ]]; then
            if is_html_error "$output_path"; then
                echo -e "  ${RED}[FAIL] Failed image download: received HTML error page${NC}"
                rm -f "$output_path"
            else
                local image_size
                image_size=$(get_file_size "$output_path")
                echo -e "  ${GREEN}[OK] Downloaded image $(basename "$output_path") (${image_size} bytes)${NC}"
                successful_downloads=$((successful_downloads + 1))
            fi
        else
            echo -e "  ${RED}[FAIL] Failed to download image $(basename "$output_path")${NC}"
            rm -f "$output_path"
        fi

        sleep "$IMAGE_DELAY_SEC"
    done <<< "$image_data"
}

compress_non_json_assets() {
    local model_dir="$1"
    local source_json="$2"
    local model_id="$3"
    local archive_base=""
    local existing_archive=""

    archive_base=$(get_model_archive_basename "$source_json" "$model_id")
    existing_archive=$(find_existing_assets_archive "$model_dir" "$archive_base" || true)

    if [[ -n "$existing_archive" ]]; then
        local existing_size
        existing_size=$(get_file_size "$existing_archive")
        echo -e "  ${GREEN}[SKIP] Assets archive already exists: $(basename "$existing_archive") (${existing_size} bytes)${NC}"
        return 0
    fi

    local archive_name="${archive_base}.zip"
    local archive_path
    archive_path=$(unique_output_path "$model_dir" "$archive_name")
    archive_name=$(basename "$archive_path")

    local -a files_to_zip=()

    while IFS= read -r file_path; do
        files_to_zip+=("$(basename "$file_path")")
    done < <(find "$model_dir" -maxdepth 1 -type f ! -name "*.json" ! -name "$archive_name")

    if [[ ${#files_to_zip[@]} -eq 0 ]]; then
        echo -e "  ${YELLOW}! No non-JSON files to compress${NC}"
        return 0
    fi

    rm -f "$archive_path"

    if command -v zip >/dev/null 2>&1; then
        (cd "$model_dir" && zip -q "$archive_name" "${files_to_zip[@]}")
    elif command -v tar >/dev/null 2>&1; then
        (cd "$model_dir" && tar -a -cf "$archive_name" "${files_to_zip[@]}")
    else
        echo -e "  ${RED}[FAIL] Could not compress files: zip/tar not found${NC}"
        return 1
    fi

    if [[ -f "$archive_path" ]] && [[ -s "$archive_path" ]]; then
        for file_name in "${files_to_zip[@]}"; do
            rm -f "${model_dir}/${file_name}"
        done
        local zip_size
        zip_size=$(get_file_size "$archive_path")
        echo -e "  ${GREEN}[OK] Created $(basename "$archive_path") (${zip_size} bytes)${NC}"
        return 0
    fi

    echo -e "  ${RED}[FAIL] Failed to create $(basename "$archive_path")${NC}"
    return 1
}

echo -e "${CYAN}========================================================${NC}"
echo -e "${CYAN}   Bulk Downloader — STL/ZIP (Enhanced Edition)        ${NC}"
echo -e "${CYAN}========================================================${NC}"
echo ""

# Validate cookie before doing anything else
echo -e "${BLUE}Validating cookie configuration...${NC}"
if ! validate_cookie; then
    exit 1
fi
echo ""

# Check if we're in the correct directory (should contain JSON files)
if ! ls model_*.json 1> /dev/null 2>&1; then
    echo -e "${RED}Error: No model JSON files found. Run the metadata downloader first (Step 1).${NC}"
    exit 1
fi

# Check if jq is available
JQ_CMD="jq"
if ! command -v jq &> /dev/null; then
    if [[ -f "${SCRIPT_DIR}/jq.exe" ]]; then
        JQ_CMD="${SCRIPT_DIR}/jq.exe"
    elif [[ -f "${SCRIPT_DIR}/jq" ]]; then
        JQ_CMD="${SCRIPT_DIR}/jq"
    elif [[ -f "../jq.exe" ]]; then
        JQ_CMD="../jq.exe"
    elif [[ -f "../jq" ]]; then
        JQ_CMD="../jq"
    elif [[ -f "./jq.exe" ]]; then
        JQ_CMD="./jq.exe"
    elif [[ -f "./jq" ]]; then
        JQ_CMD="./jq"
    else
        echo -e "${RED}Error: jq not found. Download from https://github.com/stedolan/jq/releases${NC}"
        echo "Place jq or jq.exe in the same directory as this script"
        exit 1
    fi
fi

# Create STL downloads directory
mkdir -p stl_files
cd stl_files || exit

# Count JSON files
json_count=$(find .. -name "model_*.json" -type f 2>/dev/null | wc -l)

if [[ $json_count -eq 0 ]]; then
    echo -e "${RED}Error: No JSON files found${NC}"
    exit 1
fi

echo -e "${BLUE}Found $json_count JSON files to process${NC}"
echo -e "${BLUE}Output folders: $FOLDER_NAMING_FORMAT (readable names; legacy model_<id> still supported)${NC}"

# TEST MODE - Download just one file to verify everything works
if [[ "$TEST_MODE" == true ]]; then
    echo -e "${YELLOW}=======================================${NC}"
    echo -e "${YELLOW}   RUNNING IN TEST MODE${NC}"
    echo -e "${YELLOW}=======================================${NC}"
    echo "Testing with first available model to verify cookie and setup..."
    echo ""
    
    # Find first JSON file with download URLs
    for json_file in ../model_*.json; do
        model_id=$(basename "$json_file" | sed 's/model_//; s/.json//')
        test_line=$($JQ_CMD -r '.files.items[]? | select(.download_url != null and .download_url != "") | "\(.filename // "")|\(.download_url)"' "$json_file" 2>/dev/null | head -1)

        if [[ -n "$test_line" ]]; then
            echo -e "${BLUE}Testing with model $model_id${NC}"
            
            # Get first file from this model
            filename=$(echo "$test_line" | cut -d'|' -f1 | tr -d '\r' | xargs)
            download_url=$(echo "$test_line" | cut -d'|' -f2 | tr -d '\r' | xargs)

            if [[ -z "$download_url" || "$download_url" == "null" ]]; then
                continue
            fi
            
            echo -e "  Downloading: ${CYAN}$filename${NC}"
            
            test_file="test_download_${model_id}.tmp"
            
            curl --silent -L \
                -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0" \
                -H "Accept: application/octet-stream" \
                -H "Cookie: $COOKIE" \
                --compressed \
                "$download_url" \
                -o "$test_file"
            
            echo ""
            
            if is_html_error "$test_file"; then
                echo -e "${RED}[FAIL] TEST FAILED${NC}"
                echo -e "${RED}Downloaded file is an HTML error page, not the actual file${NC}"
                echo ""
                show_error_content "$test_file"
                echo ""
                echo -e "${YELLOW}Common causes:${NC}"
                echo "  1. Cookie expired - get a fresh cookie from browser"
                echo "  2. Missing cf_clearance token - copy cookie from download request, not page view"
                echo "  3. Not logged in - make sure you're logged into MyMiniFactory in browser"
                echo "  4. Cookie formatting error - check for extra quotes or special characters"
                echo ""
                echo -e "${CYAN}How to get a fresh cookie:${NC}"
                echo "  1. Open MyMiniFactory in browser, log in"
                echo "  2. Download any file from any model"
                echo "  3. F12 -> Network -> Find 'download' request"
                echo "  4. Copy the Cookie header value"
                echo "  5. Paste into script (no extra quotes)"
                rm -f "$test_file"
                exit 1
            else
                file_size=$(stat -c%s "$test_file" 2>/dev/null || stat -f%z "$test_file" 2>/dev/null || echo "unknown")
                echo -e "${GREEN}[OK] TEST PASSED${NC}"
                echo -e "  Successfully downloaded ${CYAN}$filename${NC} (${file_size} bytes)"
                echo "  File appears to be valid (not an error page)"
                echo ""
                echo -e "${GREEN}Cookie is working! You can now run the full download:${NC}"
                echo "  bash $(basename "$0")"
                rm -f "$test_file"
                exit 0
            fi
        else
            is_bought=$($JQ_CMD -r '.is_bought // "unknown"' "$json_file" 2>/dev/null)
            if [[ "$is_bought" == "false" ]]; then
                echo -e "${YELLOW}! Skipping model $model_id in test mode: object is not in your library (is_bought=false).${NC}"
            fi
        fi
    done
    
    echo -e "${RED}No downloadable files found for testing${NC}"
    echo -e "${YELLOW}If the listed models are not owned, this is expected. Use owned models for --test.${NC}"
    exit 1
fi

# FULL DOWNLOAD MODE
echo -e "${BLUE}Extracting download URLs, images, and creating per-model ZIP files...${NC}"
echo -e "${YELLOW}This will take a while - respecting rate limits${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop at any time${NC}"
echo ""

current_file=0
total_downloads=0
successful_downloads=0
consecutive_failures=0
compact_json_written=0
zip_created=0
models_zip_skipped=0
not_owned_skipped=0
models_without_file_downloads=0

# Process each JSON file
for json_file in ../model_*.json; do
    current_file=$((current_file + 1))
    model_id=$(basename "$json_file" | sed 's/model_//; s/.json//')

    echo -e "${BLUE}[$current_file/$json_count] Processing model $model_id...${NC}"

    is_bought=$($JQ_CMD -r '.is_bought // "unknown"' "$json_file" 2>/dev/null)
    downloadable_file_count=$($JQ_CMD -r '[.files.items[]? | .download_url | select(. != null and . != "")] | length' "$json_file" 2>/dev/null)
    if [[ ! "$downloadable_file_count" =~ ^[0-9]+$ ]]; then
        downloadable_file_count=0
    fi

    # Copyright and ownership guard: if no downloadable STL/ZIP URLs exist,
    # do not create any output for this model (no metadata, no images).
    if [[ "$downloadable_file_count" -eq 0 ]]; then
        if [[ "$is_bought" == "false" ]]; then
            not_owned_skipped=$((not_owned_skipped + 1))
            models_without_file_downloads=$((models_without_file_downloads + 1))
            echo -e "${YELLOW}  ! Object is not in your library (is_bought=false). Skipping model output for model $model_id.${NC}"
        else
            models_without_file_downloads=$((models_without_file_downloads + 1))
            echo -e "${YELLOW}  ! No downloadable STL/ZIP URLs found in metadata. Skipping model output.${NC}"
        fi
        echo ""
        continue
    fi

    # Create directory for this model (readable name; falls back to legacy model_<id> if present)
    model_dir=$(resolve_model_dir "$model_id" "$json_file")
    mkdir -p "$model_dir"
    if [[ "$model_dir" != "model_${model_id}" ]]; then
        echo -e "  ${CYAN}Using folder: ${model_dir}/${NC}"
    fi
    model_file_successful_downloads=0
    model_assets_complete=0
    existing_assets_archive=""

    if model_assets_already_archived "$model_dir" "$json_file" "$model_id"; then
        existing_assets_archive=$(find_existing_assets_archive "$model_dir" "$(get_model_archive_basename "$json_file" "$model_id")")
        existing_archive_size=$(get_file_size "$existing_assets_archive")
        echo -e "  ${GREEN}[SKIP] Model assets already archived in $(basename "$existing_assets_archive") (${existing_archive_size} bytes) — skipping STL/ZIP re-download.${NC}"
        model_file_successful_downloads=$downloadable_file_count
        model_assets_complete=1
        models_zip_skipped=$((models_zip_skipped + 1))
        successful_downloads=$((successful_downloads + downloadable_file_count))
    fi

    # Extract downloadable files from metadata
    download_data=$($JQ_CMD -r '.files.items[]? | "\(.filename // "")|\(.download_url // "")"' "$json_file" 2>/dev/null)

    if [[ -z "$download_data" ]]; then
        echo -e "${YELLOW}  ! No STL/ZIP file URLs found in metadata. Skipping model output.${NC}"
        rm -rf "$model_dir"
        models_without_file_downloads=$((models_without_file_downloads + 1))
        echo ""
        continue
    elif [[ "$model_assets_complete" -eq 0 ]]; then
        while IFS='|' read -r filename download_url; do
            if [[ -z "$filename" ]]; then
                continue
            fi

            filename=$(echo "$filename" | tr -d '\r' | xargs)
            filename=$(sanitize_filename "$filename")
            download_url=$(echo "$download_url" | tr -d '\r' | xargs)

            if [[ -z "$download_url" || "$download_url" == "null" ]]; then
                echo -e "  ${YELLOW}! Skipping $filename: no download URL (likely not owned or unavailable).${NC}"
                continue
            fi

            canonical_output="${model_dir}/${filename}"

            if [[ -f "$canonical_output" ]] && [[ -s "$canonical_output" ]] && ! is_html_error "$canonical_output"; then
                file_size=$(get_file_size "$canonical_output")
                echo -e "  ${GREEN}[SKIP] Already downloaded: $(basename "$canonical_output") (${file_size} bytes)${NC}"
                successful_downloads=$((successful_downloads + 1))
                model_file_successful_downloads=$((model_file_successful_downloads + 1))
                consecutive_failures=0
                continue
            fi

            if [[ -e "$canonical_output" ]]; then
                rm -f "$canonical_output"
            fi

            output_file="$(unique_output_path "$model_dir" "$filename")"

            total_downloads=$((total_downloads + 1))

            echo -e "  ${YELLOW}Downloading file: $(basename "$output_file")${NC}"

            curl --silent -L \
                -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0" \
                -H "Accept: application/octet-stream" \
                -H "Cookie: $COOKIE" \
                --compressed \
                "$download_url" \
                -o "$output_file"

            if [[ -f "$output_file" ]] && [[ -s "$output_file" ]]; then
                if is_html_error "$output_file"; then
                    echo -e "  ${RED}[FAIL] Failed: Downloaded HTML error page instead of file${NC}"
                    consecutive_failures=$((consecutive_failures + 1))

                    if [[ $consecutive_failures -eq 1 ]]; then
                        show_error_content "$output_file"
                    fi

                    rm -f "$output_file"

                    if [[ $consecutive_failures -ge $MAX_CONSECUTIVE_FAILURES ]]; then
                        echo ""
                        echo -e "${RED}=======================================================${NC}"
                        echo -e "${RED}STOPPING: $MAX_CONSECUTIVE_FAILURES consecutive failures detected${NC}"
                        echo -e "${RED}=======================================================${NC}"
                        echo ""
                        echo -e "${YELLOW}This indicates a systematic problem (not random failures)${NC}"
                        echo ""
                        echo -e "${CYAN}Most likely causes:${NC}"
                        echo "  1. Cookie expired - get fresh cookie from browser"
                        echo "  2. Missing cf_clearance token in cookie"
                        echo "  3. Session logged out - log back into MyMiniFactory"
                        echo "  4. Account permissions issue"
                        echo ""
                        echo -e "${CYAN}To fix:${NC}"
                        echo "  1. Log into MyMiniFactory in your browser"
                        echo "  2. Download a file manually to verify access"
                        echo "  3. Copy fresh cookie from that download request (F12 -> Network)"
                        echo "  4. Update COOKIE variable in script"
                        echo "  5. Run in test mode first: bash $(basename "$0") --test"
                        echo ""
                        exit 1
                    fi
                else
                    file_size=$(get_file_size "$output_file")
                    echo -e "  ${GREEN}[OK] Downloaded $(basename "$output_file") (${file_size} bytes)${NC}"
                    successful_downloads=$((successful_downloads + 1))
                    model_file_successful_downloads=$((model_file_successful_downloads + 1))
                    consecutive_failures=0
                fi
            else
                echo -e "  ${RED}[FAIL] Failed to download $(basename "$output_file")${NC}"
                consecutive_failures=$((consecutive_failures + 1))
                rm -f "$output_file"

                if [[ $consecutive_failures -ge $MAX_CONSECUTIVE_FAILURES ]]; then
                    echo ""
                    echo -e "${RED}STOPPING: Too many consecutive failures${NC}"
                    echo "Check your internet connection and cookie validity"
                    exit 1
                fi
            fi

            sleep "$STL_FILE_DELAY_SEC"
        done <<< "$download_data"
    fi

    if [[ "$model_file_successful_downloads" -eq 0 ]]; then
        echo -e "${YELLOW}  ! No files could be downloaded for model $model_id. Removing metadata/images output for copyright compliance.${NC}"
        rm -rf "$model_dir"
        models_without_file_downloads=$((models_without_file_downloads + 1))
        echo ""
        continue
    fi

    # Build compact JSON only when at least one STL/ZIP file was downloaded.
    if write_compact_model_json "$json_file" "$model_dir" "$model_id"; then
        compact_json_written=$((compact_json_written + 1))
    fi

    # Download images only when the model has at least one successfully downloaded file.
    download_model_images "$json_file" "$model_dir"

    # Compress only model root files to a zip archive; images stay in model_<id>/images
    if [[ "$model_assets_complete" -eq 1 ]]; then
        zip_created=$((zip_created + 1))
    elif compress_non_json_assets "$model_dir" "$json_file" "$model_id"; then
        zip_created=$((zip_created + 1))
    fi

    echo ""
done

echo -e "${GREEN}=======================================${NC}"
echo -e "${GREEN}   Download Complete!${NC}"
echo -e "${GREEN}=======================================${NC}"
echo -e "${GREEN}Successful downloads: $successful_downloads/$total_downloads files and images${NC}"
if [[ $((total_downloads - successful_downloads)) -gt 0 ]]; then
    echo -e "${YELLOW}Failed downloads: $((total_downloads - successful_downloads))${NC}"
fi
if [[ "$not_owned_skipped" -gt 0 ]]; then
    echo -e "${YELLOW}Skipped models not owned: $not_owned_skipped${NC}"
fi
if [[ "$models_without_file_downloads" -gt 0 ]]; then
    echo -e "${YELLOW}Skipped model outputs with zero downloaded files: $models_without_file_downloads${NC}"
fi
if [[ "$models_zip_skipped" -gt 0 ]]; then
    echo -e "${GREEN}Models skipped (assets ZIP already present): $models_zip_skipped${NC}"
fi
echo -e "${GREEN}Compact JSON files written: $compact_json_written${NC}"
echo -e "${GREEN}ZIP archives created: $zip_created${NC}"
echo -e "${BLUE}Output structure: stl_files/<id>_<model_name>/model_<id>.json + <model_name>.zip + images/${NC}"
echo ""

echo "Sample of generated directories:"
find . -name "model_*" -type d 2>/dev/null | head -5 | while read -r dir; do
    file_count=$(find "$dir" -maxdepth 1 -type f | wc -l)
    echo "  $dir: $file_count files"
done