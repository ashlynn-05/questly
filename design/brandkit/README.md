# Questly brand kit

Generated with the built-in image_gen tool. Direction: young, modern, simple; spontaneous sidequests with friends. Bold lowercase wordmark, Q loop with a detour tail, and playful route lines.

## Assets

- [Brand board](questly-brand-board.png): primary and reverse logos, palette, type direction, sticker concepts and social application.
- [Transparent logo](questly-logo-transparent.png): iris horizontal logo PNG.
- [App icon](questly-app-icon.png): apricot Q on an opaque iris square.

## Source of truth

Palette: ../../src/app/globals.css. Typography: ../../src/app/layout.tsx (Archivo, width 125 for display and 100 for text).

| Color | Hex | Use |
| --- | --- | --- |
| Iris | #3b3686 | Main identity and night ground |
| Cornsilk | #fdf8e1 | Day ground |
| Apricot | #edba40 | Night accent |
| Orange | #e0652b | Action accent |
| Periwinkle | #767ae6 | Decorative routes |
| Jonquil | #ffd000 | Day accent |
| Ink | #1a1640 | Dark text |

Supporting existing tokens: orange-deep #e28c33, vanilla #fcefb4, jasmine #fae588, naples #f9dc5c.

Use iris/ink text on cornsilk; cornsilk or apricot on iris. Avoid small apricot text on cornsilk. Keep clear space around the logo at least the width of its Q stroke. Use the wordmark on light backgrounds; use the board's reverse treatment for dark backgrounds. Keep the icon square and let platforms apply their masks.

Voice: short, friendly invitations. Proposed copy: “Make a little detour.” and “sidequests. together.”

These are raster design assets, not vector masters. Generated colors have slight tonal variation; exact production colors and typography remain defined by the code tokens. Sticker and social designs are concepts on the board, not separate exports. The app icon in the code is not this raster: `scripts/generate-icons.sh` redraws the same Q as SVG geometry measured off it, so it stays crisp at 32px and uses the token apricot rather than the generator's drifted #f3bc2d.

## Generation prompts

### Initial board

Use case: logo-brand
Asset type: complete visual brand identity board for Questly, a social app for young adults who love spontaneous real-world sidequests with friends.
Create a polished, young, modern, simple brand kit presentation. Brand name text exactly "questly". Develop one coherent distinctive identity: a bold simple Q-shaped loop with a short outward diagonal route tail, like a spontaneous detour; no map pin, no compass, no generic sparkle. Friendly confident lowercase geometric grotesk wordmark, inspired by the existing Archivo family with slightly wide heavy letters. Keep logo extremely simple, memorable, flat, vector-friendly.
Palette from actual code: iris #3b3686, periwinkle #767ae6, apricot #edba40, orange #e0652b, cornsilk #fdf8e1, jonquil #ffd000, deep ink #1a1640. Use iris and cornsilk as dominant brand fields, apricot and orange as restrained energy accents. No extra colors.
Create a beautifully composed landscape brand board with generous whitespace and 6 carefully aligned areas: large primary wordmark and Q mark on cornsilk; reversed cream logo on iris; square app icon with apricot Q on iris; labeled palette swatches with exact hex values; type specimen titled "Archivo" with text "Make a little detour."; and a small set of simple flat sticker applications and a social tile using the SAME logo and abstract bent route lines with round stops. The board should feel like a real independent youth culture design studio, relaxed and editorial, not corporate SaaS, not childish, not video-game fantasy. Use crisp solid shapes, clear hierarchy, minimal readable annotation. No 3D, gradients, photographic mockups, shadows, clutter, or watermark. Typography and exact spelling matter. This is a single brand-board image, not a website.

### Final board correction

Reference: initial generated board.

Use case: logo-brand. Edit the referenced Questly brand board. Preserve the core Q mark, lowercase questly wordmark, palette hex labels, six-section layout, and general applications. CRITICAL CHANGE: remove EVERY shadow, glow, blur, gradient, bevel, texture, lighting effect and dimensional effect. Entire board must be truly flat, solid-color graphic design, sharp as an exported vector identity presentation. Q counters must show the exact background color. No purple blur around the primary wordmark. Background uniform #fdf8e1. Purple fields uniform #3b3686. Replace the tiny alphabet specimen with only a clean line 'Bold headlines. Easy reading.' Keep Archivo heading and Make a little detour. text. Clean minimalist youth culture identity. All other colors same original palette.

### Transparent logo

Reference: final board.

Use case: logo-brand. Reference image is the Questly brand identity board. Produce ONLY the primary horizontal logo as an isolated clean transparent PNG: the same bold iris #3b3686 Q loop symbol with diagonal tail, followed by the same bold friendly lowercase wordmark 'questly'. Preserve the reference letter shapes and proportions. No slogan, no route decoration, no board, no additional objects. Wide horizontal composition, generous transparent margins, entirely flat one-color iris artwork, crisp edges, no shadows or glow. Background truly transparent including all letter counters and Q interior. This is a standalone logo asset.

### Final icon

Create a flat app icon image. Square canvas filled edge-to-edge with an opaque solid purple background, hex #3b3686. Center a single large bold golden yellow capital Q symbol, hex #edba40: circular thick ring and short diagonal tail extending toward lower right, softly rounded corners. The symbol fills 62% of square width. Exactly two solid colors with crisp antialiased edges. Background must be opaque purple everywhere including inside Q circle. No transparency. No shadows. No glows. No gradients. No lighting. No texture. No text other than Q. Not a photo. Plain vector-style graphic.

