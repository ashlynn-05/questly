#!/usr/bin/env bash
#
# Draws the Questly app icon and rasterises every size the platforms actually
# use. The PNGs it writes are COMMITTED, so nobody needs this script (or
# rsvg-convert) to build or run the app -- it exists so the icon is a drawing
# that can be changed and re-emitted, rather than six binaries nobody can edit.
#
#   brew install librsvg && ./scripts/generate-icons.sh
#
# The mark is the brand kit's Q, redrawn as geometry rather than resampled from
# design/brandkit/questly-app-icon.png. That file is a 1254px raster from an
# image generator, so its edges carry the generator's own tonal drift and it
# cannot be scaled to 32px without going soft; the numbers below are measured
# off it (ring centre 626,610 outer radius 428 stroke 145, tail cap centre
# 995,1013 -- scaled by 512/1254) so the drawing and the raster are the same
# mark, and this one stays crisp at every size.
#
# The route line that used to be here is gone. It was the product's wayfinding
# language, but the brand kit settled the identity on the Q and a home screen
# should carry the identity, not a second one.
#
# The Q is apricot rather than the raster's #f3bc2d: apricot is a token, it is
# 5.68:1 on iris, and orange would be 2.95:1 -- under AA at the 48px this has
# to read at. Colours are --q-iris / --q-apricot from src/app/globals.css,
# written as literals because an SVG on a home screen has no stylesheet to
# resolve a var() against.
set -euo pipefail

cd "$(dirname "$0")/.."

command -v rsvg-convert >/dev/null || {
  echo "rsvg-convert not found. brew install librsvg" >&2
  exit 1
}

IRIS="#3b3686"
APRICOT="#edba40"

# The art, centred in a 512 box: bounds are x 78..434, y 72..442, whose centre
# is 256,257 -- the tail hanging off the lower right is what pulls the ring up
# and left of centre, and the mark would look hung if the ring were centred
# instead.
#
# The tail starts ON the ring's centre line, not short of it and not past it.
# Its round cap has the same radius as half the stroke, so a cap centred on
# that line is swallowed whole by the ring and the two shapes union into one
# silhouette. Started further in, the cap pokes a bump into the counter --
# visible at 512 and mush at 32.
art() {
  cat <<SVG
    <circle cx="253" cy="247" r="145" fill="none" stroke="$APRICOT" stroke-width="59"/>
    <path d="M351 354 404 412" fill="none" stroke="$APRICOT" stroke-width="59"
          stroke-linecap="round"/>
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
# the centre 80% -- a circle of radius 205. The art's furthest point is the
# tail's end cap, at radius 244 from the box centre, so 205/244 = 0.84 is the
# largest scale that fits and 0.83 takes it with a little room to spare. The
# ground still runs to all four edges, which is the whole point of a maskable
# icon.
svg_maskable() {
  cat <<SVG
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <title>Questly</title>
  <rect width="512" height="512" fill="$IRIS"/>
  <g transform="translate(256 256) scale(0.83) translate(-256 -256)">
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
