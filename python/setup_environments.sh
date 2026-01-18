#!/bin/bash
#
# setup_environments.sh - Automated Python Environment Setup Script
#
# This script automatically creates and configures dual Python virtual environments
# for WhisperX (transcription) and Pyannote (speaker diarization).
#
# Features:
#   - Detects Python 3.12 installation
#   - Creates separate venvs to avoid torch version conflicts
#   - Installs all dependencies automatically
#   - Downloads required ML models with HF_TOKEN
#   - Verifies installation with import tests
#   - Generates environment validation report
#
# Usage:
#   ./setup_environments.sh [options]
#
# Options:
#   --skip-models     Skip model download (useful for development)
#   --force           Force recreate environments even if they exist
#   --quiet           Reduce output verbosity
#   --json            Output progress in JSON format (for Electron integration)
#   --help            Show this help message
#
# Exit codes:
#   0  - Success
#   1  - Python not found or version too old
#   2  - Failed to create virtual environment
#   3  - Failed to install dependencies
#   4  - Verification failed
#   5  - Model download failed
#

set -e

# ============================================================================
# Configuration
# ============================================================================

# Script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
VENV_WHISPERX="${SCRIPT_DIR}/venv-whisperx"
VENV_PYANNOTE="${SCRIPT_DIR}/venv-pyannote"
ENV_METADATA_FILE="${SCRIPT_DIR}/.env.json"

# Required Python version
MIN_PYTHON_MAJOR=3
MIN_PYTHON_MINOR=9
PREFERRED_PYTHON_VERSION="3.12"  # Preferred, but 3.9+ will work

# Options
SKIP_MODELS=false
FORCE_RECREATE=false
QUIET=false
JSON_OUTPUT=false

# Colors for output (disabled for JSON mode)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ============================================================================
# Helper Functions
# ============================================================================

# Print usage information
usage() {
    grep '^#' "$0" | grep -v '#!/' | sed 's/^# //' | sed 's/^#//'
    exit 0
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --skip-models)
                SKIP_MODELS=true
                shift
                ;;
            --force)
                FORCE_RECREATE=true
                shift
                ;;
            --quiet)
                QUIET=true
                shift
                ;;
            --json)
                JSON_OUTPUT=true
                # Disable colors for JSON mode
                RED=''
                GREEN=''
                YELLOW=''
                BLUE=''
                CYAN=''
                NC=''
                shift
                ;;
            --help|-h)
                usage
                ;;
            *)
                echo "Unknown option: $1"
                usage
                ;;
        esac
    done
}

# Get current timestamp in ISO format
get_timestamp() {
    date -u +"%Y-%m-%dT%H:%M:%SZ"
}

# Output progress (handles both text and JSON modes)
# Usage: progress STEP PERCENTAGE MESSAGE [ESTIMATED_TIME]
progress() {
    local step="$1"
    local percentage="$2"
    local message="$3"
    local estimated_time="${4:-}"

    if [ "$JSON_OUTPUT" = true ]; then
        local json="{\"type\":\"progress\",\"step\":\"$step\",\"percentage\":$percentage,\"message\":\"$message\""
        if [ -n "$estimated_time" ]; then
            json="$json,\"estimatedTime\":\"$estimated_time\""
        fi
        json="$json,\"timestamp\":\"$(get_timestamp)\"}"
        echo "$json"
    else
        if [ "$QUIET" = false ]; then
            printf "${BLUE}[%3d%%]${NC} ${CYAN}%-20s${NC} %s" "$percentage" "$step:" "$message"
            if [ -n "$estimated_time" ]; then
                printf " ${YELLOW}(~%s)${NC}" "$estimated_time"
            fi
            printf "\n"
        fi
    fi
}

# Output success message
success() {
    local message="$1"
    if [ "$JSON_OUTPUT" = true ]; then
        echo "{\"type\":\"success\",\"message\":\"$message\",\"timestamp\":\"$(get_timestamp)\"}"
    else
        echo -e "${GREEN}✓${NC} $message"
    fi
}

# Output error message
error() {
    local message="$1"
    local code="${2:-1}"
    if [ "$JSON_OUTPUT" = true ]; then
        echo "{\"type\":\"error\",\"message\":\"$message\",\"code\":$code,\"timestamp\":\"$(get_timestamp)\"}"
    else
        echo -e "${RED}✗ Error:${NC} $message" >&2
    fi
}

# Output warning message
warning() {
    local message="$1"
    if [ "$JSON_OUTPUT" = true ]; then
        echo "{\"type\":\"warning\",\"message\":\"$message\",\"timestamp\":\"$(get_timestamp)\"}"
    else
        echo -e "${YELLOW}⚠${NC} $message"
    fi
}

# Output step completion
step_complete() {
    local step="$1"
    if [ "$JSON_OUTPUT" = true ]; then
        echo "{\"type\":\"step_complete\",\"step\":\"$step\",\"timestamp\":\"$(get_timestamp)\"}"
    else
        success "$step completed"
    fi
}

# ============================================================================
# Python Detection
# ============================================================================

detect_python() {
    progress "detect_python" 5 "Detecting Python 3.9+ installation..." "10s"

    # Note: PYTHON_CMD is intentionally NOT local so it can be used globally
    PYTHON_CMD=""

    # Homebrew installation locations (checked first - most reliable for required versions)
    # These paths may not be in PATH when running from Electron apps
    local HOMEBREW_PYTHON_PATHS=(
        "/opt/homebrew/bin/python3.12"          # Apple Silicon Homebrew (preferred)
        "/opt/homebrew/bin/python3.11"
        "/opt/homebrew/bin/python3.10"
        "/usr/local/bin/python3.12"             # Intel Homebrew
        "/usr/local/bin/python3.11"
        "/usr/local/bin/python3.10"
        "/opt/homebrew/bin/python3"             # Generic python3 (may be older)
        "/usr/local/bin/python3"
    )

    # IMPORTANT: Check Homebrew locations FIRST to ensure we get Python 3.10+
    # System Python on macOS is often 3.9.x which is too old
    for python_path in "${HOMEBREW_PYTHON_PATHS[@]}"; do
        if [ -x "$python_path" ]; then
            PYTHON_CMD="$python_path"
            break
        fi
    done

    # Fallback: Check PATH if Homebrew Python not found
    if [ -z "$PYTHON_CMD" ]; then
        if command -v python3.12 &> /dev/null; then
            PYTHON_CMD="python3.12"
        elif command -v python3.11 &> /dev/null; then
            PYTHON_CMD="python3.11"
        elif command -v python3.10 &> /dev/null; then
            PYTHON_CMD="python3.10"
        elif command -v python3 &> /dev/null; then
            PYTHON_CMD="python3"
        elif command -v python &> /dev/null; then
            PYTHON_CMD="python"
        fi
    fi

    # Verify we found Python
    if [ -z "$PYTHON_CMD" ]; then
        error "Python 3 not found. Please install Python ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}+ or $PREFERRED_PYTHON_VERSION." 1

        if [ "$JSON_OUTPUT" = true ]; then
            echo "{\"type\":\"remediation\",\"remediationSteps\":[\"Install Python ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}+ from https://www.python.org/downloads/\",\"On macOS: brew install python@3.12\",\"On Ubuntu: sudo apt install python3.12\",\"Verify installation: python3.12 --version\"]}"
        else
            echo ""
            echo "Installation instructions:"
            echo "  macOS:   brew install python@3.12"
            echo "  Ubuntu:  sudo apt install python3.12"
            echo "  Windows: Download from https://www.python.org/downloads/"
        fi
        exit 1
    fi

    # Get full version info
    PYTHON_VERSION=$("$PYTHON_CMD" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")')
    PYTHON_MAJOR=$("$PYTHON_CMD" -c 'import sys; print(sys.version_info.major)')
    PYTHON_MINOR=$("$PYTHON_CMD" -c 'import sys; print(sys.version_info.minor)')

    # Verify minimum version
    if [ "$PYTHON_MAJOR" -lt "$MIN_PYTHON_MAJOR" ] || \
       ([ "$PYTHON_MAJOR" -eq "$MIN_PYTHON_MAJOR" ] && [ "$PYTHON_MINOR" -lt "$MIN_PYTHON_MINOR" ]); then
        error "Python $PYTHON_VERSION is too old. Requires Python ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}+ (found $PYTHON_VERSION)" 1

        if [ "$JSON_OUTPUT" = true ]; then
            echo "{\"type\":\"remediation\",\"remediationSteps\":[\"Upgrade Python to ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}+ or $PREFERRED_PYTHON_VERSION\",\"On macOS: brew install python@$PREFERRED_PYTHON_VERSION\",\"On Ubuntu: sudo apt install python$PREFERRED_PYTHON_VERSION\",\"Download from: https://www.python.org/downloads/\"]}"
        fi
        exit 1
    fi

    success "Found Python $PYTHON_VERSION at $(which $PYTHON_CMD)"

    # Export for use in other functions
    export PYTHON_CMD
    export PYTHON_VERSION

    step_complete "detect_python"
}

# ============================================================================
# Check Dependencies
# ============================================================================

check_dependencies() {
    progress "check_deps" 10 "Checking system dependencies..." "5s"

    # Check for ffmpeg
    if command -v ffmpeg &> /dev/null; then
        local ffmpeg_version=$(ffmpeg -version 2>&1 | head -n1)
        success "ffmpeg found: $ffmpeg_version"
    else
        warning "ffmpeg not found. Audio processing may be limited."
        if [ "$JSON_OUTPUT" = true ]; then
            echo "{\"type\":\"remediation\",\"steps\":[\"Install ffmpeg:\",\"  macOS: brew install ffmpeg\",\"  Ubuntu: sudo apt install ffmpeg\",\"  Windows: Download from https://ffmpeg.org/download.html\"]}"
        else
            echo "  Install ffmpeg:"
            echo "    macOS:   brew install ffmpeg"
            echo "    Ubuntu:  sudo apt install ffmpeg"
            echo "    Windows: Download from https://ffmpeg.org/download.html"
        fi
    fi

    # Check for git (needed for some pip packages)
    if command -v git &> /dev/null; then
        success "git found"
    else
        warning "git not found. Some packages may fail to install."
    fi

    step_complete "check_deps"
}

# ============================================================================
# Create Virtual Environments
# ============================================================================

create_venv() {
    local venv_name="$1"
    local venv_path="$2"
    local purpose="$3"
    local base_progress="$4"

    progress "create_$venv_name" "$base_progress" "Creating $venv_name environment..." "30s"

    # Verify PYTHON_CMD is set
    if [ -z "$PYTHON_CMD" ]; then
        error "PYTHON_CMD not set. Python detection may have failed." 2
        exit 2
    fi

    # Check if environment already exists
    if [ -d "$venv_path" ]; then
        if [ "$FORCE_RECREATE" = true ]; then
            warning "Removing existing $venv_name environment..."
            rm -rf "$venv_path"
        else
            success "$venv_name environment already exists"
            step_complete "create_$venv_name"
            return 0
        fi
    fi

    # Create the virtual environment
    if ! "$PYTHON_CMD" -m venv "$venv_path"; then
        error "Failed to create $venv_name virtual environment" 2
        exit 2
    fi

    success "Created $venv_name at $venv_path"
    step_complete "create_$venv_name"
}

# ============================================================================
# Install Dependencies
# ============================================================================

install_dependencies() {
    local venv_name="$1"
    local venv_path="$2"
    local requirements_file="$3"
    local base_progress="$4"

    progress "install_$venv_name" "$base_progress" "Installing $venv_name dependencies..." "5-10 min"

    # Determine pip path
    local pip_cmd
    if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "win32" ]]; then
        pip_cmd="$venv_path/Scripts/pip"
    else
        pip_cmd="$venv_path/bin/pip"
    fi

    # Upgrade pip first
    progress "upgrade_pip_$venv_name" "$((base_progress + 2))" "Upgrading pip in $venv_name..." "30s"
    if ! "$pip_cmd" install --upgrade pip > /dev/null 2>&1; then
        error "Failed to upgrade pip in $venv_name" 3
        exit 3
    fi

    # Install requirements
    progress "pip_install_$venv_name" "$((base_progress + 5))" "Installing packages from $requirements_file..." "5-10 min"

    # Create a temp file to capture pip errors
    local pip_error_file=$(mktemp)

    if [ "$QUIET" = true ] || [ "$JSON_OUTPUT" = true ]; then
        if ! "$pip_cmd" install -r "$SCRIPT_DIR/$requirements_file" > /dev/null 2>"$pip_error_file"; then
            local pip_error=$(cat "$pip_error_file" | tail -20)
            error "Failed to install dependencies for $venv_name: $pip_error" 3
            rm -f "$pip_error_file"
            exit 3
        fi
    else
        if ! "$pip_cmd" install -r "$SCRIPT_DIR/$requirements_file" 2>&1 | tee "$pip_error_file"; then
            local pip_error=$(cat "$pip_error_file" | tail -20)
            error "Failed to install dependencies for $venv_name: $pip_error" 3
            rm -f "$pip_error_file"
            exit 3
        fi
    fi

    rm -f "$pip_error_file"

    # Install common utilities
    progress "pip_install_common_$venv_name" "$((base_progress + 8))" "Installing common utilities..." "1-2 min"

    if [ -f "$SCRIPT_DIR/requirements-common.txt" ]; then
        if [ "$QUIET" = true ] || [ "$JSON_OUTPUT" = true ]; then
            if ! "$pip_cmd" install -r "$SCRIPT_DIR/requirements-common.txt" > /dev/null 2>&1; then
                warning "Failed to install common utilities for $venv_name (non-fatal)"
            fi
        else
            if ! "$pip_cmd" install -r "$SCRIPT_DIR/requirements-common.txt"; then
                warning "Failed to install common utilities for $venv_name (non-fatal)"
            fi
        fi
    fi

    success "Installed dependencies for $venv_name"
    step_complete "install_$venv_name"
}

# ============================================================================
# Verify Installation
# ============================================================================

verify_environment() {
    local venv_name="$1"
    local venv_path="$2"
    local expected_packages="$3"
    local base_progress="$4"

    progress "verify_$venv_name" "$base_progress" "Verifying $venv_name installation..." "30s"

    # Determine python path
    local python_cmd
    if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "win32" ]]; then
        python_cmd="$venv_path/Scripts/python"
    else
        python_cmd="$venv_path/bin/python"
    fi

    local all_passed=true

    # Split packages by comma and check each
    IFS=',' read -ra packages <<< "$expected_packages"
    for package in "${packages[@]}"; do
        local import_name=$(echo "$package" | xargs) # trim whitespace

        if "$python_cmd" -c "import $import_name" 2>/dev/null; then
            success "  $import_name: OK"
        else
            error "  $import_name: FAILED"
            all_passed=false
        fi
    done

    # Check torch version
    local torch_version=$("$python_cmd" -c "import torch; print(torch.__version__)" 2>/dev/null)
    if [ -n "$torch_version" ]; then
        success "  torch version: $torch_version"
    else
        error "  torch: NOT INSTALLED"
        all_passed=false
    fi

    # Check CUDA availability
    local cuda_available=$("$python_cmd" -c "import torch; print(torch.cuda.is_available())" 2>/dev/null)
    if [ "$cuda_available" = "True" ]; then
        success "  CUDA: Available"
    else
        warning "  CUDA: Not available (CPU mode will be used)"
    fi

    if [ "$all_passed" = false ]; then
        error "Verification failed for $venv_name" 4
        exit 4
    fi

    step_complete "verify_$venv_name"
}

# ============================================================================
# Download Models
# ============================================================================

download_models() {
    if [ "$SKIP_MODELS" = true ]; then
        warning "Skipping model download (--skip-models flag)"
        return 0
    fi

    progress "download_models" 75 "Downloading ML models..." "10-20 min"

    # Check for HF_TOKEN
    if [ -z "$HF_TOKEN" ]; then
        warning "HF_TOKEN not set. Model download will be skipped."
        warning "Set HF_TOKEN environment variable with your HuggingFace token to download models."

        if [ "$JSON_OUTPUT" = true ]; then
            echo "{\"type\":\"remediation\",\"steps\":[\"1. Create an account at https://huggingface.co\",\"2. Accept model terms at https://huggingface.co/pyannote/speaker-diarization-3.1\",\"3. Create an access token at https://huggingface.co/settings/tokens\",\"4. Set HF_TOKEN environment variable: export HF_TOKEN=your_token_here\"]}"
        else
            echo ""
            echo "To download models:"
            echo "  1. Create an account at https://huggingface.co"
            echo "  2. Accept model terms at https://huggingface.co/pyannote/speaker-diarization-3.1"
            echo "  3. Create an access token at https://huggingface.co/settings/tokens"
            echo "  4. Set HF_TOKEN: export HF_TOKEN=your_token_here"
            echo "  5. Re-run this script"
        fi
        return 0
    fi

    # Use venv-pyannote to run model download (it has the required packages)
    local python_cmd
    if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "win32" ]]; then
        python_cmd="$VENV_PYANNOTE/Scripts/python"
    else
        python_cmd="$VENV_PYANNOTE/bin/python"
    fi

    # Run the model download script
    if [ -f "$SCRIPT_DIR/download_models.py" ]; then
        progress "download_pyannote_models" 80 "Downloading Pyannote models..." "10-15 min"

        if "$python_cmd" "$SCRIPT_DIR/download_models.py"; then
            success "Pyannote models downloaded successfully"
        else
            warning "Some models failed to download. You can retry later from Settings."
        fi
    else
        warning "download_models.py not found. Models will be downloaded on first use."
    fi

    step_complete "download_models"
}

# ============================================================================
# Generate Metadata
# ============================================================================

generate_metadata() {
    progress "generate_metadata" 95 "Generating environment metadata..." "5s"

    local whisperx_python
    local pyannote_python

    if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "win32" ]]; then
        whisperx_python="$VENV_WHISPERX/Scripts/python"
        pyannote_python="$VENV_PYANNOTE/Scripts/python"
    else
        whisperx_python="$VENV_WHISPERX/bin/python"
        pyannote_python="$VENV_PYANNOTE/bin/python"
    fi

    # Get package versions
    local whisperx_torch_version=$("$whisperx_python" -c "import torch; print(torch.__version__)" 2>/dev/null || echo "unknown")
    local whisperx_version=$("$whisperx_python" -c "import whisperx; print(getattr(whisperx, '__version__', 'installed'))" 2>/dev/null || echo "unknown")
    local pyannote_torch_version=$("$pyannote_python" -c "import torch; print(torch.__version__)" 2>/dev/null || echo "unknown")
    local pyannote_version=$("$pyannote_python" -c "from pyannote.audio import Pipeline; import pyannote.audio; print(pyannote.audio.__version__)" 2>/dev/null || echo "unknown")

    # Generate JSON metadata
    cat > "$ENV_METADATA_FILE" << EOF
{
  "schemaVersion": 1,
  "createdAt": "$(get_timestamp)",
  "updatedAt": "$(get_timestamp)",
  "setupScript": "setup_environments.sh",
  "systemPython": {
    "version": "$PYTHON_VERSION",
    "path": "$(which $PYTHON_CMD)"
  },
  "environments": {
    "whisperx": {
      "path": "$VENV_WHISPERX",
      "pythonVersion": "$PYTHON_VERSION",
      "packages": {
        "torch": "$whisperx_torch_version",
        "whisperx": "$whisperx_version"
      },
      "purpose": "transcription",
      "status": "ready"
    },
    "pyannote": {
      "path": "$VENV_PYANNOTE",
      "pythonVersion": "$PYTHON_VERSION",
      "packages": {
        "torch": "$pyannote_torch_version",
        "pyannote.audio": "$pyannote_version"
      },
      "purpose": "diarization",
      "status": "ready"
    }
  },
  "models": {
    "downloaded": $([ "$SKIP_MODELS" = true ] && echo "false" || echo "true"),
    "hfTokenConfigured": $([ -n "$HF_TOKEN" ] && echo "true" || echo "false")
  },
  "platform": {
    "os": "$(uname -s)",
    "arch": "$(uname -m)",
    "osVersion": "$(uname -r)"
  }
}
EOF

    success "Generated environment metadata at $ENV_METADATA_FILE"
    step_complete "generate_metadata"
}

# ============================================================================
# Print Summary
# ============================================================================

print_summary() {
    if [ "$JSON_OUTPUT" = true ]; then
        echo "{\"type\":\"complete\",\"success\":true,\"message\":\"Setup completed successfully\",\"timestamp\":\"$(get_timestamp)\"}"
    else
        echo ""
        echo -e "${BLUE}========================================${NC}"
        echo -e "${GREEN}  Setup Complete!${NC}"
        echo -e "${BLUE}========================================${NC}"
        echo ""
        echo -e "${CYAN}Environments created:${NC}"
        echo "  • venv-whisperx: For transcription (WhisperX + torch 2.5.0)"
        echo "  • venv-pyannote: For diarization (Pyannote + torch 2.5.1)"
        echo ""
        echo -e "${CYAN}Next steps:${NC}"
        echo "  1. The app will automatically use these environments"
        echo "  2. Models will be downloaded when needed (requires HF_TOKEN)"
        echo ""
        if [ -z "$HF_TOKEN" ]; then
            echo -e "${YELLOW}Note: HF_TOKEN not set. Configure it in Settings to enable speaker diarization.${NC}"
            echo ""
        fi
        echo -e "${CYAN}Metadata saved to:${NC}"
        echo "  $ENV_METADATA_FILE"
        echo ""
    fi
}

# ============================================================================
# Main
# ============================================================================

main() {
    parse_args "$@"

    if [ "$JSON_OUTPUT" = false ] && [ "$QUIET" = false ]; then
        echo -e "${BLUE}========================================${NC}"
        echo -e "${BLUE}  Meeting Notes - Python Environment Setup${NC}"
        echo -e "${BLUE}========================================${NC}"
        echo ""
    fi

    # Step 1: Detect Python (5%)
    detect_python

    # Step 2: Check dependencies (10%)
    check_dependencies

    # Step 3: Create WhisperX environment (15-25%)
    create_venv "venv-whisperx" "$VENV_WHISPERX" "transcription" 15

    # Step 4: Install WhisperX dependencies (25-40%)
    install_dependencies "venv-whisperx" "$VENV_WHISPERX" "requirements-whisperx.txt" 25

    # Step 5: Verify WhisperX installation (40-45%)
    verify_environment "venv-whisperx" "$VENV_WHISPERX" "whisperx,faster_whisper,torch,torchaudio" 40

    # Step 6: Create Pyannote environment (45-50%)
    create_venv "venv-pyannote" "$VENV_PYANNOTE" "diarization" 45

    # Step 7: Install Pyannote dependencies (50-65%)
    install_dependencies "venv-pyannote" "$VENV_PYANNOTE" "requirements-pyannote.txt" 50

    # Step 8: Verify Pyannote installation (65-70%)
    verify_environment "venv-pyannote" "$VENV_PYANNOTE" "pyannote.audio,speechbrain,torch,torchaudio" 65

    # Step 9: Download models (75-90%)
    download_models

    # Step 10: Generate metadata (95%)
    generate_metadata

    # Final: Print summary (100%)
    progress "complete" 100 "Setup completed successfully"
    print_summary

    exit 0
}

# Run main function
main "$@"
