#!/usr/bin/env bash
#
# Draws the Questly app icon and rasterises every size the platforms actually
# use. The PNGs it writes are COMMITTED, so nobody needs this script (or
# rsvg-convert) to build or run the app -- it exists so the icon is a drawing
# that can be changed and re-emitted, rather than six binaries nobody can edit.
#
#   brew install librsvg && ./scripts/generate-icons.sh
#
# The mark is the product's own wayfinding language, drawn the way MapTile in
# src/components/questly/frame.tsx already draws it: one orange route line
# stepping up and to the right on the iris ground, ending on a destination
# roundel. The roundel is apricot rather than orange because orange is 2.95:1
# on iris and this has to read at 48px on a home screen; apricot is 5.68:1.
#
# Colours are --q-iris / --q-orange / --q-apricot from src/app/globals.css. They
# are literals here because an SVG on a home screen has no stylesheet to
# resolve a var() against.
set -euo pipefail

cd "$(dirname "$0")/.."

command -v rsvg-convert >/dev/null || {
  echo "rsvg-convert not found. brew install librsvg" >&2
  exit 1
}

IRIS="#3b3686"
ORANGE="#e0652b"
APRICOT="#edba40"

# The art, centred in a 512 box: bounds are x 101..411, y 85..427, so the
# margins are equal on all four sides and the mark does not look hung.
art() {
  cat <<SVG
    <path d="M123 405H235V277H347V149" fill="none" stroke="$ORANGE" stroke-width="44"
          stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="347" cy="149" r="64" fill="$APRICOT"/>
    <circle cx="347" cy="149" r="26" fill="$IRIS"/>
SVG
}

# The icon as it is drawn everywhere the platform does not crop it.
svg() {
  cat <<SVG
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <title>Questly</title>
  <rect width="512" height="512" fill="$IRIS"/>
$(art)
</svg>
SVG
}

# The maskable variant. Android crops to an arbitrary shape and only guarantees
# the centre 80% -- a circle of radius 205, and the tight art's own corner sits
# at radius 230. 0.85 pulls it inside with a little room to spare; the ground
# still runs to all four edges, which is the whole point of a maskable icon.
svg_maskable() {
  cat <<SVG
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <title>Questly</title>
  <rect width="512" height="512" fill="$IRIS"/>
  <g transform="translate(256 256) scale(0.85) translate(-256 -256)">
$(art)
  </g>
</svg>
SVG
}

# The tab icon is the drawing itself, not a raster of it.
svg > src/app/icon.svg

png() { # png <size> <destination>
  rsvg-convert -w "$1" -h "$1" -o "$2" src/app/icon.svg
}

png 32 src/app/icon.png          # fallback for tabs without SVG favicon support
png 180 src/app/apple-icon.png   # what iOS puts on the home screen
png 192 public/icon-192.png      # Chrome's installability floor
png 512 public/icon-512.png      # Chrome's installability ceiling, and the splash

svg_maskable | rsvg-convert -w 512 -h 512 -o public/icon-maskable-512.png /dev/stdin

echo "wrote src/app/icon.svg src/app/icon.png src/app/apple-icon.png public/icon-{192,512}.png public/icon-maskable-512.png"
