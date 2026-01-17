#!/bin/bash
# =============================================================================
# Linux Virtual Audio Sink Setup Script
# Meeting Notes Application
# =============================================================================
#
# This script creates a PulseAudio virtual sink for capturing system audio.
# Run this script once to set up the virtual audio routing.
#
# Usage:
#   ./setup-virtual-sink.sh          # Create virtual sink
#   ./setup-virtual-sink.sh --remove # Remove virtual sink
#   ./setup-virtual-sink.sh --status # Check current status
#

set -e

SINK_NAME="meeting_notes_sink"
SINK_DESCRIPTION="Meeting Notes Virtual Sink"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}!${NC} $1"
}

print_info() {
    echo -e "  $1"
}

# Check if PulseAudio is running
check_pulseaudio() {
    if ! command -v pactl &> /dev/null; then
        print_error "PulseAudio (pactl) is not installed."
        print_info "Install it with: sudo apt install pulseaudio-utils"
        exit 1
    fi

    if ! pulseaudio --check 2>/dev/null; then
        print_error "PulseAudio is not running."
        print_info "Start it with: pulseaudio --start"
        exit 1
    fi
}

# Check if virtual sink exists
sink_exists() {
    pactl list short sinks 2>/dev/null | grep -q "$SINK_NAME"
}

# Check if null sink module is loaded
get_module_id() {
    pactl list short modules 2>/dev/null | grep "module-null-sink.*$SINK_NAME" | cut -f1
}

# Create virtual sink
create_sink() {
    echo "Creating virtual audio sink..."

    if sink_exists; then
        print_warning "Virtual sink '$SINK_NAME' already exists."
        print_info "Use --remove to recreate it."
        return 0
    fi

    # Load null sink module
    MODULE_ID=$(pactl load-module module-null-sink \
        sink_name="$SINK_NAME" \
        sink_properties=device.description="$SINK_DESCRIPTION" 2>&1)

    if [ $? -eq 0 ]; then
        print_success "Virtual sink created successfully!"
        print_info "Sink name: $SINK_NAME"
        print_info "Module ID: $MODULE_ID"
        echo ""
        print_info "To capture system audio:"
        print_info "1. Open Sound Settings"
        print_info "2. Set output device to '$SINK_DESCRIPTION'"
        print_info "3. In Meeting Notes, select '$SINK_DESCRIPTION' as audio input"
        echo ""
        print_warning "Note: This sink is temporary and will be removed on reboot."
        print_info "To make it permanent, add to /etc/pulse/default.pa:"
        print_info "  load-module module-null-sink sink_name=$SINK_NAME sink_properties=device.description=\"$SINK_DESCRIPTION\""
    else
        print_error "Failed to create virtual sink: $MODULE_ID"
        exit 1
    fi
}

# Remove virtual sink
remove_sink() {
    echo "Removing virtual audio sink..."

    if ! sink_exists; then
        print_warning "Virtual sink '$SINK_NAME' does not exist."
        return 0
    fi

    MODULE_ID=$(get_module_id)

    if [ -n "$MODULE_ID" ]; then
        pactl unload-module "$MODULE_ID" 2>/dev/null
        if [ $? -eq 0 ]; then
            print_success "Virtual sink removed successfully!"
        else
            print_error "Failed to remove virtual sink."
            exit 1
        fi
    else
        print_warning "Could not find module ID for virtual sink."
    fi
}

# Show status
show_status() {
    echo "Virtual Audio Sink Status"
    echo "========================="
    echo ""

    if sink_exists; then
        print_success "Virtual sink '$SINK_NAME' is active."
        echo ""
        echo "Sink details:"
        pactl list sinks 2>/dev/null | grep -A 15 "Name: $SINK_NAME" | head -16
    else
        print_warning "Virtual sink '$SINK_NAME' is not configured."
        print_info "Run this script without arguments to create it."
    fi
}

# Print usage
print_usage() {
    echo "Usage: $0 [OPTION]"
    echo ""
    echo "Options:"
    echo "  (none)     Create virtual audio sink"
    echo "  --remove   Remove virtual audio sink"
    echo "  --status   Show current status"
    echo "  --help     Show this help message"
    echo ""
    echo "This script sets up a PulseAudio virtual sink for capturing"
    echo "system audio in the Meeting Notes application."
}

# Main
main() {
    check_pulseaudio

    case "${1:-}" in
        --remove)
            remove_sink
            ;;
        --status)
            show_status
            ;;
        --help|-h)
            print_usage
            ;;
        "")
            create_sink
            ;;
        *)
            print_error "Unknown option: $1"
            print_usage
            exit 1
            ;;
    esac
}

main "$@"
