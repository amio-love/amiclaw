#!/usr/bin/env bash
# Generate a real-speech PCM16 16kHz mono fixture for the live-turn harness.
#
# Produces the exact wire format the STT adapter expects
# (../src/providers/volcengine.ts: format:'pcm', rate:16000, bits:16, channel:1):
# raw headerless little-endian signed 16-bit mono samples at 16kHz.
#
# Usage:
#   demo/make-fixture.sh                       # default phrase -> demo/fixture-red-wire.pcm
#   demo/make-fixture.sh "the red wire" out.pcm
#   demo/make-fixture.sh "红色的线" demo/fixture-zh.pcm
#
# Requires macOS `say` + `afconvert` (both preinstalled). The synthesized speech
# is a short phrase plausibly relevant to a BombSquad turn.
set -euo pipefail

PHRASE="${1:-the red wire}"
OUT="${2:-demo/fixture-red-wire.pcm}"
TMP_AIFF="$(mktemp -t live-fixture).aiff"
trap 'rm -f "$TMP_AIFF"' EXIT

# 1. Synthesize the phrase to an AIFF (default macOS voice).
say "$PHRASE" -o "$TMP_AIFF"

# 2. Transcode to raw PCM16 16kHz mono, headerless little-endian:
#    -d LEI16  signed 16-bit little-endian
#    -c 1      mono
#    -r 16000  16kHz
#    -f caff   container during convert; we strip to raw below
#    Using `-f WAVE` then stripping the 44-byte header would also work, but
#    afconvert's `-f` raw output is cleanest with the `caff`->raw approach via
#    ffmpeg-free path: we emit a WAV and strip its header.
WAV_TMP="$(mktemp -t live-fixture).wav"
afconvert "$TMP_AIFF" "$WAV_TMP" -d LEI16@16000 -c 1 -f WAVE
# Strip the 44-byte canonical WAV header to leave raw PCM16 samples.
tail -c +45 "$WAV_TMP" > "$OUT"
rm -f "$WAV_TMP"

BYTES="$(wc -c < "$OUT" | tr -d ' ')"
SECONDS_F="$(awk "BEGIN { printf \"%.2f\", $BYTES / 32000 }")"
echo "Wrote $OUT — $BYTES bytes (~${SECONDS_F}s of PCM16 16kHz mono) for phrase: \"$PHRASE\""
