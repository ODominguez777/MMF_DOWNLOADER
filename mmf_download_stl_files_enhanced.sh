#!/bin/bash

# MyMiniFactory Bulk STL/ZIP File Downloader (Enhanced Edition)
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
COOKIE='REPLACE_WITH_YOUR_ACTUAL_COOKIE_STRING'
# ============================================================================

# Configuration
TEST_MODE=false
MAX_CONSECUTIVE_FAILURES=3  # Stop if this many downloads fail in a row

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
    
    echo -e "${GREEN}✓ Cookie format looks valid${NC}"
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

echo -e "${CYAN}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   MyMiniFactory STL Downloader - Enhanced Edition     ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════╝${NC}"
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

if [[ $json_count -eq 0 ]]; then
    echo -e "${RED}Error: No JSON files found${NC}"
    exit 1
fi

echo -e "${BLUE}Found $json_count JSON files to process${NC}"

# TEST MODE - Download just one file to verify everything works
if [[ "$TEST_MODE" == true ]]; then
    echo -e "${YELLOW}═══════════════════════════════════════${NC}"
    echo -e "${YELLOW}   RUNNING IN TEST MODE${NC}"
    echo -e "${YELLOW}═══════════════════════════════════════${NC}"
    echo "Testing with first available model to verify cookie and setup..."
    echo ""
    
    # Find first JSON file with download URLs
    for json_file in ../model_*.json; do
        model_id=$(basename "$json_file" | sed 's/model_//; s/.json//')
        download_data=$($JQ_CMD -r '.files.items[] | "\(.filename)|\(.download_url)"' "$json_file" 2>/dev/null)
        
        if [[ -n "$download_data" ]]; then
            echo -e "${BLUE}Testing with model $model_id${NC}"
            
            # Get first file from this model
            filename=$(echo "$download_data" | head -1 | cut -d'|' -f1 | tr -d '\r' | xargs)
            download_url=$(echo "$download_data" | head -1 | cut -d'|' -f2 | tr -d '\r' | xargs)
            
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
                echo -e "${RED}✗ TEST FAILED${NC}"
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
                echo "  3. F12 → Network → Find 'download' request"
                echo "  4. Copy the Cookie header value"
                echo "  5. Paste into script (no extra quotes)"
                rm -f "$test_file"
                exit 1
            else
                file_size=$(stat -c%s "$test_file" 2>/dev/null || stat -f%z "$test_file" 2>/dev/null || echo "unknown")
                echo -e "${GREEN}✓ TEST PASSED${NC}"
                echo -e "  Successfully downloaded ${CYAN}$filename${NC} (${file_size} bytes)"
                echo "  File appears to be valid (not an error page)"
                echo ""
                echo -e "${GREEN}Cookie is working! You can now run the full download:${NC}"
                echo "  bash $(basename "$0")"
                rm -f "$test_file"
                exit 0
            fi
        fi
    done
    
    echo -e "${RED}No models with download URLs found for testing${NC}"
    exit 1
fi

# FULL DOWNLOAD MODE
echo -e "${BLUE}Extracting download URLs and downloading STL/ZIP files...${NC}"
echo -e "${YELLOW}This will take a while - respecting rate limits${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop at any time${NC}"
echo ""

current_file=0
total_downloads=0
successful_downloads=0
consecutive_failures=0

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
            curl --silent -L \
                -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0" \
                -H "Accept: application/octet-stream" \
                -H "Cookie: $COOKIE" \
                --compressed \
                "$download_url" \
                -o "$output_file"
            
            # Check if download was successful
            if [[ -f "$output_file" ]] && [[ -s "$output_file" ]]; then
                # Check if we got an HTML error page instead of actual file
                if is_html_error "$output_file"; then
                    echo -e "  ${RED}✗ Failed: Downloaded HTML error page instead of file${NC}"
                    consecutive_failures=$((consecutive_failures + 1))
                    
                    # Show error content for first failure
                    if [[ $consecutive_failures -eq 1 ]]; then
                        show_error_content "$output_file"
                    fi
                    
                    rm -f "$output_file"
                    
                    # Stop if too many consecutive failures
                    if [[ $consecutive_failures -ge $MAX_CONSECUTIVE_FAILURES ]]; then
                        echo ""
                        echo -e "${RED}═══════════════════════════════════════════════════════${NC}"
                        echo -e "${RED}STOPPING: $MAX_CONSECUTIVE_FAILURES consecutive failures detected${NC}"
                        echo -e "${RED}═══════════════════════════════════════════════════════${NC}"
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
                        echo "  3. Copy fresh cookie from that download request (F12 → Network)"
                        echo "  4. Update COOKIE variable in script"
                        echo "  5. Run in test mode first: bash $(basename "$0") --test"
                        echo ""
                        exit 1
                    fi
                else
                    file_size=$(stat -c%s "$output_file" 2>/dev/null || stat -f%z "$output_file" 2>/dev/null || echo "unknown")
                    echo -e "  ${GREEN}✓ Downloaded $filename (${file_size} bytes)${NC}"
                    successful_downloads=$((successful_downloads + 1))
                    consecutive_failures=0  # Reset on success
                fi
            else
                echo -e "  ${RED}✗ Failed to download $filename${NC}"
                consecutive_failures=$((consecutive_failures + 1))
                rm -f "$output_file"
                
                # Stop if too many consecutive failures
                if [[ $consecutive_failures -ge $MAX_CONSECUTIVE_FAILURES ]]; then
                    echo ""
                    echo -e "${RED}STOPPING: Too many consecutive failures${NC}"
                    echo "Check your internet connection and cookie validity"
                    exit 1
                fi
            fi
            
            # Rate limiting: sleep for 2 seconds between downloads
            sleep 2
        fi
    done <<< "$download_data"
    
    echo ""
done

echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN}   Download Complete!${NC}"
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN}Successfully downloaded: $successful_downloads/$total_downloads files${NC}"
if [[ $((total_downloads - successful_downloads)) -gt 0 ]]; then
    echo -e "${YELLOW}Failed: $((total_downloads - successful_downloads)) files${NC}"
fi
echo -e "${BLUE}Files are organized in the 'stl_files' directory by model ID${NC}"
echo ""

# Show sample of downloaded content
echo "Sample of downloaded directories:"
find . -name "model_*" -type d 2>/dev/null | head -5 | while read -r dir; do
    file_count=$(find "$dir" -type f | wc -l)
    echo "  $dir: $file_count files"
done