#!/bin/bash

# MyMiniFactory Bulk STL/ZIP File Downloader
# Downloads actual 3D printable files from a list of model IDs
# This is STEP 2 - run AFTER the metadata downloader creates JSON files
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
# 4. Run: bash download_stl_files.sh

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# UPDATE THIS: Get your cookie from browser developer tools (F12 -> Network -> Copy Cookie header)
COOKIE="${MMF_COOKIE:-REPLACE_WITH_YOUR_ACTUAL_COOKIE_STRING}"

# Check if we're in the correct directory (should contain JSON files)
if ! ls model_*.json 1> /dev/null 2>&1; then
    echo -e "${RED}Error: No model JSON files found. Run the metadata downloader first (Step 1).${NC}"
    exit 1
fi

# Check if jq is available
JQ_CMD="jq"
if ! command -v jq &> /dev/null; then
    if [[ -f "./jq.exe" ]]; then
        JQ_CMD="../jq.exe"
    elif [[ -f "./jq" ]]; then
        JQ_CMD="../jq"
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
current_file=0
total_downloads=0
successful_downloads=0

echo -e "${BLUE}Found $json_count JSON files to process${NC}"
echo -e "${BLUE}Extracting download URLs and downloading STL/ZIP files...${NC}"
echo -e "${YELLOW}This will take a while - respecting rate limits${NC}"
echo ""

# Process each JSON file
for json_file in ../model_*.json; do
    current_file=$((current_file + 1))
    model_id=$(basename "$json_file" | sed 's/model_//; s/.json//')
    
    echo -e "${BLUE}[$current_file/$json_count] Processing model $model_id...${NC}"
    
    # Extract download URLs and filenames using jq
    download_data=$($JQ_CMD -r '.files.items[] | "\(.filename)|\(.download_url)"' "$json_file" 2>/dev/null)
    
    if [[ -z "$download_data" ]]; then
        echo -e "${RED}  ✗ No download URLs found in $json_file${NC}"
        continue
    fi
    
    # Create directory for this model
    model_dir="model_${model_id}"
    mkdir -p "$model_dir"
    
    # Download each file
    while IFS='|' read -r filename download_url; do
        if [[ -n "$filename" && -n "$download_url" ]]; then
            # Clean carriage returns and whitespace (Windows line ending fix)
            filename=$(echo "$filename" | tr -d '\r' | xargs)
            download_url=$(echo "$download_url" | tr -d '\r' | xargs)
            
            total_downloads=$((total_downloads + 1))
            output_file="${model_dir}/${filename}"
            
            echo -e "  ${YELLOW}Downloading: $filename${NC}"
            
            # Download with redirect following and proper headers
            curl --silent \
                -L \
                -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0" \
                -H "Accept: application/octet-stream" \
                -H "Cookie: $COOKIE" \
                --compressed \
                "$download_url" \
                -o "$output_file"
            
            # Check if download was successful
            if [[ -f "$output_file" ]] && [[ -s "$output_file" ]]; then
                file_size=$(stat -c%s "$output_file" 2>/dev/null || stat -f%z "$output_file" 2>/dev/null || echo "unknown")
                echo -e "  ${GREEN}✓ Downloaded $filename (${file_size} bytes)${NC}"
                successful_downloads=$((successful_downloads + 1))
            else
                echo -e "  ${RED}✗ Failed to download $filename${NC}"
                # Remove empty/failed file
                rm -f "$output_file"
            fi
            
            # Rate limiting: sleep for 2 seconds between downloads
            sleep 2
        fi
    done <<< "$download_data"
    
    echo ""
done

echo -e "${GREEN}Download complete!${NC}"
echo -e "${GREEN}Successfully downloaded: $successful_downloads/$total_downloads files${NC}"
echo -e "${BLUE}Files are organized in the 'stl_files' directory by model ID${NC}"
echo ""
echo "Directory structure:"
find . -name "model_*" -type d 2>/dev/null | head -10

# Common Issues and Solutions:
# 
# 1. "No download URLs found" - Verify JSON files exist and contain file data
# 2. "Failed to download" with valid URLs - Cookie expired, get fresh cookie
# 3. "URL malformed" errors - Windows line ending issue (script handles automatically)
# 4. "jq not found" - Download jq.exe and place in same directory as script
# 5. All downloads redirect to login - Cookie expired or invalid
# 6. Only photos download, not STL files - Missing -L flag for redirects (fixed in script)
#
# Tips:
# - Cookies expire frequently (30-60 min), refresh if downloads start failing
# - Script follows redirects automatically with -L flag
# - Rate limited to 2 seconds between downloads (respectful to servers)
# - Large STL files take longer, be patient
# - Windows line endings are automatically cleaned from URLs
# - Each model gets its own subdirectory with all associated files