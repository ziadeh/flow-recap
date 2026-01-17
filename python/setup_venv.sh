#!/bin/bash
#
# setup_venv.sh - Python virtual environment setup script
#
# This script creates a Python virtual environment and installs
# the required dependencies for audio transcription and diarization.
#
# Requirements:
#   - Python 3.10 or higher
#   - pip
#   - ffmpeg (for audio processing)
#
# Usage:
#   ./setup_venv.sh
#
# After running this script:
#   1. Activate the environment: source venv/bin/activate
#   2. Set your Hugging Face token: export HF_TOKEN=your_token
#   3. Run transcription: python transcribe.py audio.wav
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# Use venv-3.12 by default for Python 3.12+ compatibility
VENV_DIR="${SCRIPT_DIR}/venv-3.12"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Meeting Notes - Python Environment Setup${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check Python version
check_python() {
    echo -e "${YELLOW}Checking Python installation...${NC}"

    # Try python3 first, then python
    if command -v python3 &> /dev/null; then
        PYTHON_CMD="python3"
    elif command -v python &> /dev/null; then
        PYTHON_CMD="python"
    else
        echo -e "${RED}Error: Python not found. Please install Python 3.10 or higher.${NC}"
        exit 1
    fi

    # Check version
    PYTHON_VERSION=$($PYTHON_CMD -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
    PYTHON_MAJOR=$($PYTHON_CMD -c 'import sys; print(sys.version_info.major)')
    PYTHON_MINOR=$($PYTHON_CMD -c 'import sys; print(sys.version_info.minor)')

    if [ "$PYTHON_MAJOR" -lt 3 ] || ([ "$PYTHON_MAJOR" -eq 3 ] && [ "$PYTHON_MINOR" -lt 10 ]); then
        echo -e "${RED}Error: Python 3.10 or higher is required. Found version $PYTHON_VERSION${NC}"
        exit 1
    fi

    echo -e "${GREEN}Found Python $PYTHON_VERSION${NC}"
}

# Check for ffmpeg
check_ffmpeg() {
    echo -e "${YELLOW}Checking ffmpeg installation...${NC}"

    if command -v ffmpeg &> /dev/null; then
        FFMPEG_VERSION=$(ffmpeg -version 2>&1 | head -n1)
        echo -e "${GREEN}Found: $FFMPEG_VERSION${NC}"
    else
        echo -e "${RED}Warning: ffmpeg not found.${NC}"
        echo -e "${YELLOW}Please install ffmpeg:${NC}"
        echo "  macOS:  brew install ffmpeg"
        echo "  Ubuntu: sudo apt-get install ffmpeg"
        echo "  Windows: Download from https://ffmpeg.org/download.html"
        echo ""
        read -p "Continue anyway? (y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
}

# Create virtual environment
create_venv() {
    echo ""
    echo -e "${YELLOW}Creating virtual environment...${NC}"

    if [ -d "$VENV_DIR" ]; then
        echo -e "${YELLOW}Virtual environment already exists at $VENV_DIR${NC}"
        read -p "Remove and recreate? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            rm -rf "$VENV_DIR"
        else
            echo -e "${GREEN}Using existing virtual environment.${NC}"
            return
        fi
    fi

    $PYTHON_CMD -m venv "$VENV_DIR"
    echo -e "${GREEN}Virtual environment created at $VENV_DIR${NC}"
}

# Activate virtual environment
activate_venv() {
    echo ""
    echo -e "${YELLOW}Activating virtual environment...${NC}"
    source "$VENV_DIR/bin/activate"
    echo -e "${GREEN}Virtual environment activated.${NC}"
}

# Upgrade pip
upgrade_pip() {
    echo ""
    echo -e "${YELLOW}Upgrading pip...${NC}"
    pip install --upgrade pip
    echo -e "${GREEN}pip upgraded.${NC}"
}

# Install dependencies
install_dependencies() {
    echo ""
    echo -e "${YELLOW}Installing dependencies...${NC}"
    echo -e "${YELLOW}This may take several minutes...${NC}"
    echo ""

    # Install PyTorch first (CPU or GPU based on availability)
    echo -e "${BLUE}Installing PyTorch...${NC}"

    # Check for NVIDIA GPU
    if command -v nvidia-smi &> /dev/null; then
        echo -e "${GREEN}NVIDIA GPU detected. Installing PyTorch with CUDA support...${NC}"
        pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu118
    else
        echo -e "${YELLOW}No NVIDIA GPU detected. Installing CPU-only PyTorch...${NC}"
        pip install torch torchaudio
    fi

    # Install remaining dependencies from requirements.txt
    echo ""
    echo -e "${BLUE}Installing remaining dependencies...${NC}"
    pip install -r "$SCRIPT_DIR/requirements.txt"

    echo -e "${GREEN}Dependencies installed.${NC}"
}

# Verify installation
verify_installation() {
    echo ""
    echo -e "${YELLOW}Verifying installation...${NC}"

    # Check imports
    echo -e "${BLUE}Checking whisperx...${NC}"
    if python -c "import whisperx" 2>/dev/null; then
        echo -e "${GREEN}  whisperx: OK${NC}"
    else
        echo -e "${RED}  whisperx: FAILED${NC}"
    fi

    echo -e "${BLUE}Checking pyannote.audio...${NC}"
    if python -c "from pyannote.audio import Pipeline" 2>/dev/null; then
        echo -e "${GREEN}  pyannote.audio: OK${NC}"
    else
        echo -e "${RED}  pyannote.audio: FAILED${NC}"
    fi

    echo -e "${BLUE}Checking ffmpeg-python...${NC}"
    if python -c "import ffmpeg" 2>/dev/null; then
        echo -e "${GREEN}  ffmpeg-python: OK${NC}"
    else
        echo -e "${RED}  ffmpeg-python: FAILED${NC}"
    fi

    echo -e "${BLUE}Checking torch...${NC}"
    if python -c "import torch; print(f'  PyTorch version: {torch.__version__}')" 2>/dev/null; then
        python -c "import torch; print(f'  CUDA available: {torch.cuda.is_available()}')"
    else
        echo -e "${RED}  torch: FAILED${NC}"
    fi
}

# Print usage instructions
print_usage() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${GREEN}Setup complete!${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
    echo -e "${YELLOW}To use the Python tools:${NC}"
    echo ""
    echo "1. Activate the virtual environment:"
    echo -e "   ${GREEN}source ${VENV_DIR}/bin/activate${NC}"
    echo ""
    echo "2. For speaker diarization, set your Hugging Face token:"
    echo -e "   ${GREEN}export HF_TOKEN=your_huggingface_token${NC}"
    echo ""
    echo "   Get access at: https://huggingface.co/pyannote/speaker-diarization-3.1"
    echo ""
    echo "3. Run transcription:"
    echo -e "   ${GREEN}python transcribe.py your_audio.wav${NC}"
    echo ""
    echo "4. Run speaker diarization:"
    echo -e "   ${GREEN}python diarize.py your_audio.wav${NC}"
    echo ""
    echo "5. Process audio files:"
    echo -e "   ${GREEN}python audio_processor.py info your_audio.wav${NC}"
    echo -e "   ${GREEN}python audio_processor.py prepare video.mp4 --output audio.wav${NC}"
    echo ""
    echo "6. Deactivate when done:"
    echo -e "   ${GREEN}deactivate${NC}"
    echo ""
}

# Main execution
main() {
    cd "$SCRIPT_DIR"

    check_python
    check_ffmpeg
    create_venv
    activate_venv
    upgrade_pip
    install_dependencies
    verify_installation
    print_usage
}

main "$@"
