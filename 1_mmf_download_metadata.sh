#!/bin/bash

# MyMiniFactory Model Metadata Downloader
# Downloads JSON metadata for a list of model IDs from MyMiniFactory API
# This is STEP 1 - run this first to get model metadata, then use the STL downloader
#
# Prerequisites:
# 1. Create model_ids.txt with one model ID per line (no commas, no spaces)
# 2. Valid MyMiniFactory session cookie
# 3. Models must be owned/accessible by your account
#
# Usage:
# 1. Update COOKIE variable below with your session cookie
# 2. Ensure model_ids.txt has clean line endings (Unix format)
# 3. Run: bash download_metadata.sh

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# UPDATE THIS: Get your cookie from browser developer tools (F12 -> Network -> Copy Cookie header)
COOKIE='REPLACE_WITH_YOUR_ACTUAL_COOKIE_STRING'

# Check if model_ids.txt exists
if [[ ! -f "model_ids.txt" ]]; then
    echo -e "${RED}Error: model_ids.txt not found!${NC}"
    echo "Create a file with one model ID per line, like:"
    echo "409352"
    echo "409348" 
    echo "496377"
    exit 1
fi

# Create downloads directory
mkdir -p downloads
cd downloads || exit

# Fix Windows line endings if present (common issue)
if grep -q $'\r' ../model_ids.txt; then
    echo -e "${BLUE}Fixing Windows line endings in model_ids.txt...${NC}"
    sed -i 's/\r$//' ../model_ids.txt
fi

# Count total models
total=$(wc -l < ../model_ids.txt)
current=0

echo -e "${BLUE}Starting download of $total model metadata files...${NC}"
echo "JSON files will be saved in the 'downloads' directory"
echo "Rate limited to 20 requests per minute (3 second delay between requests)"
echo ""

# Read each ID and download metadata
while read -r id; do
    # Skip empty lines
    [[ -z "$id" ]] && continue
    
    current=$((current + 1))
    echo -e "${BLUE}[$current/$total] Downloading metadata for model $id...${NC}"
    
    # Make the API request to get model metadata
    curl --silent \
        -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0" \
        -H "Accept: application/json" \
        -H "Accept-Language: en-US,en;q=0.5" \
        -H "Accept-Encoding: gzip, deflate, br, zstd" \
        -H "Referer: https://www.myminifactory.com/api-doc/index.html" \
        -H "Connection: keep-alive" \
        -H "Cookie: $COOKIE" \
        -H "Sec-Fetch-Dest: empty" \
        -H "Sec-Fetch-Mode: cors" \
        -H "Sec-Fetch-Site: same-origin" \
        -H "Priority: u=0" \
        --compressed \
        "https://www.myminifactory.com/api/v2/objects/$id" \
        -o "model_${id}.json"
    
    # Check if download was successful
    if [[ -f "model_${id}.json" ]] && [[ -s "model_${id}.json" ]]; then
        echo -e "${GREEN}✓ Successfully downloaded metadata for model $id${NC}"
    else
        echo -e "${RED}✗ Failed to download metadata for model $id${NC}"
        # Remove empty/failed file
        rm -f "model_${id}.json"
    fi
    
    # Rate limiting: sleep for 3 seconds (20 requests per minute)
    if [[ $current -lt $total ]]; then
        sleep 3
    fi
    
done < ../model_ids.txt

echo ""
echo -e "${GREEN}Metadata download complete!${NC}"
echo "Downloaded files are in the 'downloads' directory"
echo "Total JSON files: $(ls -1 model_*.json 2>/dev/null | wc -l)"
echo ""
echo -e "${BLUE}Next step: Use the STL downloader script to get actual 3D files${NC}"

# Common Issues and Solutions:
#
# 1. "Failed to download" - Check cookie expiration, get fresh cookie from browser
# 2. All downloads fail - Cookie expired or malformed, copy fresh cookie from developer tools
# 3. Some models fail - Model might be private, deleted, or require different permissions
# 4. "model_ids.txt not found" - Create file with one model ID per line
# 5. Windows line ending issues - Script automatically fixes these
#
# Tips:
# - Copy cookie from browser: F12 -> Network tab -> find any request -> Copy Cookie header
# - Cookies expire frequently (30-60 minutes), refresh as needed
# - Model IDs are numbers like 409352, not full URLs
# - One ID per line in model_ids.txt, no commas or extra formatting
# - This downloads metadata only, use STL downloader script for actual files