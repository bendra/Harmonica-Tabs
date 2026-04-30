#!/usr/bin/env bash
#
# record-samples.sh — guided harmonica sample recorder
#
# Prompts for recording type, harmonica key, and session details, then
# guides through each recording with a 3-second countdown and 10 seconds of
# capture time.
#
# Types:
#   single   — walks all 20 holes (1–10 blow/draw), one file each
#   repeated — records one note played multiple times; prompts for more until Q
#   chord    — records multiple holes played simultaneously; prompts for more until Q
#
# Requires: brew install sox
#
# Controls during each recording:
#   SPACE  — start recording (3-second countdown, then 10 seconds)
#   S      — skip this note/chord (keep existing file if any)
#   Q      — quit immediately
#
# Output structure:
#   sound-samples/<key>_harmonica/single_notes/take_<N>/<hole>_<dir>.wav
#   sound-samples/<key>_harmonica/repeated_notes/take_<N>/<hole>_<dir>_x<count>.wav
#   sound-samples/<key>_harmonica/chords/take_<N>/<1_blow-2_blow-3_blow>.wav

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
# Prompt: recording type
# ---------------------------------------------------------------------------

echo ""
echo "=== Harmonica Sample Recorder ==="
echo ""
echo "What type of recording?"
echo "  1) Single notes   — record all 20 holes (1–10 blow/draw) one at a time"
echo "  2) Repeated notes — record one note played multiple times in a row"
echo "  3) Chords         — record multiple holes played simultaneously"
echo ""
printf "Choice [1/2/3]: "
read -r TYPE_INPUT

case "$TYPE_INPUT" in
    1|single)   RECORD_TYPE="single"   ;;
    2|repeated) RECORD_TYPE="repeated" ;;
    3|chord)    RECORD_TYPE="chord"    ;;
    *)
        echo "Invalid choice. Exiting."
        exit 1
        ;;
esac

# ---------------------------------------------------------------------------
# Prompt: harmonica key (shared for all types)
# ---------------------------------------------------------------------------

echo ""
printf "Harmonica key (e.g. C, G, A, Bb, E, Ab): "
read -r HARP_KEY

if [[ -z "$HARP_KEY" ]]; then
    echo "No key entered. Exiting."
    exit 1
fi

HARP_KEY_LOWER=$(echo "$HARP_KEY" | tr '[:upper:]' '[:lower:]' | tr -d ' ')
HARP_DIR_NAME="${HARP_KEY_LOWER}_harmonica"
HARP_BASE_DIR="$SAMPLES_DIR/$HARP_DIR_NAME"

# ---------------------------------------------------------------------------
# Helper: find the highest existing take number in a directory.
# Returns 0 if no takes exist yet.
# ---------------------------------------------------------------------------

max_take_in() {
    local dir="$1"
    local max=0
    if [[ -d "$dir" ]]; then
        for d in "$dir"/take_*/; do
            if [[ -d "$d" ]]; then
                local num
                num=$(basename "$d" | sed 's/take_//')
                if [[ "$num" =~ ^[0-9]+$ ]] && (( num > max )); then
                    max=$num
                fi
            fi
        done
    fi
    echo "$max"
}

# ---------------------------------------------------------------------------
# Recording functions
# ---------------------------------------------------------------------------

# record_note: used by the single-notes loop; reads TAKE_DIR from the environment.
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

# record_file: generic single-file recording used by repeated-notes and chords.
record_file() {
    local label="$1"
    local outfile="$2"

    if [[ -f "$outfile" ]]; then
        printf "%s [exists] — SPACE / S / Q: " "$label"
    else
        printf "%s — SPACE / S / Q: " "$label"
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
                printf "  Saved: %s\n" "$(basename "$outfile")"
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

# ===========================================================================
# Branch: single notes (original behavior)
# ===========================================================================

if [[ "$RECORD_TYPE" == "single" ]]; then

    HARP_DIR="$HARP_BASE_DIR/single_notes"
    MAX_TAKE=$(max_take_in "$HARP_DIR")
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

    for hole in $(seq 1 10); do
        for dir in blow draw; do
            record_note "$hole" "$dir"
        done
    done

    echo ""
    echo "Done!  $HARP_KEY harmonica, take $TAKE_NUM — all 20 notes recorded."
    echo "Run 'npm run detect-offline' from harmonica-tabs/ to test detection."
    echo ""

# ===========================================================================
# Branch: repeated notes
# ===========================================================================

elif [[ "$RECORD_TYPE" == "repeated" ]]; then

    REPEATED_DIR="$HARP_BASE_DIR/repeated_notes"
    MAX_TAKE=$(max_take_in "$REPEATED_DIR")
    NEXT_TAKE=$(( MAX_TAKE + 1 ))

    echo ""
    if (( MAX_TAKE == 0 )); then
        echo "No existing repeated-note takes for $HARP_KEY harmonica."
    else
        echo "Existing repeated-note takes for $HARP_KEY harmonica:"
        for d in "$REPEATED_DIR"/take_*/; do
            if [[ -d "$d" ]]; then
                COUNT=$(find "$d" -name "*.wav" | wc -l | tr -d ' ')
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

    echo ""
    printf "How many times will each note be played? "
    read -r REPEAT_COUNT
    if ! [[ "$REPEAT_COUNT" =~ ^[0-9]+$ ]] || (( REPEAT_COUNT < 1 )); then
        echo "Please enter a positive number. Exiting."
        exit 1
    fi

    TAKE_DIR="$REPEATED_DIR/take_$TAKE_NUM"
    mkdir -p "$TAKE_DIR"

    echo ""
    echo "Recording: $HARP_KEY harmonica, repeated notes x$REPEAT_COUNT — take $TAKE_NUM"
    echo "Output:    $TAKE_DIR"
    echo ""
    echo "Controls:  SPACE = record   S = skip   Q = quit"
    echo ""

    for hole in $(seq 1 10); do
        for dir in blow draw; do
            OUTFILE="$TAKE_DIR/${hole}_${dir}_x${REPEAT_COUNT}.wav"
            LABEL=$(printf "Hole %2d %-4s x%s" "$hole" "$dir" "$REPEAT_COUNT")
            record_file "$LABEL" "$OUTFILE"
        done
    done

    echo ""
    echo "Done!  $HARP_KEY harmonica, repeated notes x$REPEAT_COUNT, take $TAKE_NUM — all 20 notes recorded."
    echo ""

# ===========================================================================
# Branch: chords
# ===========================================================================

elif [[ "$RECORD_TYPE" == "chord" ]]; then

    CHORD_DIR="$HARP_BASE_DIR/chords"
    MAX_TAKE=$(max_take_in "$CHORD_DIR")
    NEXT_TAKE=$(( MAX_TAKE + 1 ))

    echo ""
    if (( MAX_TAKE == 0 )); then
        echo "No existing chord takes for $HARP_KEY harmonica."
    else
        echo "Existing chord takes for $HARP_KEY harmonica:"
        for d in "$CHORD_DIR"/take_*/; do
            if [[ -d "$d" ]]; then
                COUNT=$(find "$d" -name "*.wav" | wc -l | tr -d ' ')
                echo "  $(basename "$d")  ($COUNT file(s))"
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

    TAKE_DIR="$CHORD_DIR/take_$TAKE_NUM"
    mkdir -p "$TAKE_DIR"

    echo ""
    echo "Recording: $HARP_KEY harmonica, chords — take $TAKE_NUM"
    echo "Output:    $TAKE_DIR"
    echo ""
    echo "Enter the notes of each chord as space-separated '<hole>_<dir>' tokens."
    echo "Example:   1_blow 2_blow 3_blow   or   4_draw 5_draw"
    echo ""
    echo "Controls:  SPACE = record   S = skip   Q = quit"
    echo "Enter Q at the chord prompt when you are finished."
    echo ""

    while true; do
        printf "Notes in chord (or Q to finish): "
        read -r NOTES_INPUT

        case "$NOTES_INPUT" in
            q|Q) break ;;
            "")  echo "  No notes entered. Try again."; continue ;;
        esac

        # Validate each token: must be <number>_blow or <number>_draw
        ALL_VALID=true
        for token in $NOTES_INPUT; do
            if ! [[ "$token" =~ ^[0-9]+_(blow|draw)$ ]]; then
                echo "  Invalid token '$token'. Use format '<hole>_<dir>', e.g. '3_blow' or '4_draw'."
                ALL_VALID=false
                break
            fi
        done
        if [[ "$ALL_VALID" == false ]]; then
            continue
        fi

        # Build filename: join tokens with dashes, e.g. "1_blow-2_blow-3_blow.wav"
        CHORD_NAME=$(echo "$NOTES_INPUT" | tr ' ' '-')
        OUTFILE="$TAKE_DIR/${CHORD_NAME}.wav"

        echo ""
        echo "  Play these notes together: $NOTES_INPUT"
        record_file "Chord: $NOTES_INPUT" "$OUTFILE"
        echo ""
    done

    echo ""
    echo "Done!  $HARP_KEY harmonica, chords, take $TAKE_NUM."
    echo ""

fi
