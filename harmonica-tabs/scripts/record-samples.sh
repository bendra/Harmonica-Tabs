#!/usr/bin/env bash
#
# record-samples.sh — guided harmonica sample recorder
#
# Prompts for key and take number, then walks through each hole (1–10) in
# blow/draw order, recording a 10-second WAV for each note.
#
# Requires: brew install sox
#
# Controls during recording session:
#   SPACE  — record this note (3-second countdown, then 10 seconds recording)
#   S      — skip (keep existing file if any)
#   Q      — quit immediately
#
# Output structure mirrors what detect-offline.ts expects:
#   sound-samples/<key>_harmonica/single_notes/take_<N>/<hole>_<dir>.wav

set -euo pipefail

# ---------------------------------------------------------------------------
# Check prerequisites
# ---------------------------------------------------------------------------

if ! command -v rec &> /dev/null; then
    echo "Error: 'rec' (part of sox) is not installed."
    echo "Install with: brew install sox"
    exit 1
fi

# ---------------------------------------------------------------------------
# Locate the sound-samples directory
# (two levels up from this script: harmonica-tabs/scripts/ → repo root)
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SAMPLES_DIR="$(cd "$SCRIPT_DIR/../../" && pwd)/sound-samples"

# ---------------------------------------------------------------------------
# Prompt: harmonica key
# ---------------------------------------------------------------------------

echo ""
echo "=== Harmonica Sample Recorder ==="
echo ""
printf "Harmonica key (e.g. C, G, A, Bb, E, Ab): "
read -r HARP_KEY

if [[ -z "$HARP_KEY" ]]; then
    echo "No key entered. Exiting."
    exit 1
fi

# Normalize to a folder-safe lowercase name: "Bb" → "bb_harmonica"
HARP_KEY_LOWER=$(echo "$HARP_KEY" | tr '[:upper:]' '[:lower:]' | tr -d ' ')
HARP_DIR_NAME="${HARP_KEY_LOWER}_harmonica"
HARP_DIR="$SAMPLES_DIR/$HARP_DIR_NAME/single_notes"

mkdir -p "$HARP_DIR"

# ---------------------------------------------------------------------------
# Prompt: take number
# ---------------------------------------------------------------------------

MAX_TAKE=0
for d in "$HARP_DIR"/take_*/; do
    if [[ -d "$d" ]]; then
        NUM=$(basename "$d" | sed 's/take_//')
        if [[ "$NUM" =~ ^[0-9]+$ ]] && (( NUM > MAX_TAKE )); then
            MAX_TAKE=$NUM
        fi
    fi
done
NEXT_TAKE=$(( MAX_TAKE + 1 ))

echo ""
if (( MAX_TAKE == 0 )); then
    echo "No existing takes for $HARP_KEY harmonica."
else
    echo "Existing takes for $HARP_KEY harmonica:"
    for d in "$HARP_DIR"/take_*/; do
        if [[ -d "$d" ]]; then
            COUNT=$(ls "$d"*.wav 2>/dev/null | wc -l | tr -d ' ')
            echo "  $(basename "$d")  ($COUNT / 20 files)"
        fi
    done
fi

echo ""
printf "Take number [default: %d]: " "$NEXT_TAKE"
read -r TAKE_INPUT
TAKE_NUM="${TAKE_INPUT:-$NEXT_TAKE}"

if ! [[ "$TAKE_NUM" =~ ^[0-9]+$ ]]; then
    echo "Invalid take number. Exiting."
    exit 1
fi

TAKE_DIR="$HARP_DIR/take_$TAKE_NUM"
mkdir -p "$TAKE_DIR"

echo ""
echo "Recording: $HARP_KEY harmonica — take $TAKE_NUM"
echo "Output:    $TAKE_DIR"
echo ""
echo "Controls:  SPACE = record   S = skip   Q = quit"
echo ""

# ---------------------------------------------------------------------------
# Recording function
# ---------------------------------------------------------------------------

record_note() {
    local hole=$1
    local dir=$2
    local outfile="$TAKE_DIR/${hole}_${dir}.wav"
    local label
    label=$(printf "Hole %2d %-4s" "$hole" "$dir")

    if [[ -f "$outfile" ]]; then
        printf "%s [exists] — SPACE / S / Q: " "$label"
    else
        printf "%s          — SPACE / S / Q: " "$label"
    fi

    while true; do
        local key
        IFS= read -r -s -n 1 key
        case "$key" in
            " ")
                printf "recording\n"
                printf "  3... "; sleep 1
                printf "2... ";   sleep 1
                printf "1... ";   sleep 1
                printf "Go!\n"
                rec -q -r 44100 -c 1 -e signed-integer -b 16 "$outfile" trim 0 10
                printf "  Saved: %d_%s.wav\n" "$hole" "$dir"
                break
                ;;
            s|S)
                printf "skipped\n"
                break
                ;;
            q|Q)
                printf "\nQuit.\n"
                exit 0
                ;;
        esac
    done
}

# ---------------------------------------------------------------------------
# Main loop: holes 1–10, blow then draw
# ---------------------------------------------------------------------------

for hole in $(seq 1 10); do
    for dir in blow draw; do
        record_note "$hole" "$dir"
    done
done

echo ""
echo "Done!  $HARP_KEY harmonica, take $TAKE_NUM — all 20 notes recorded."
echo "Run 'npm run detect-offline' from harmonica-tabs/ to test detection."
echo ""
