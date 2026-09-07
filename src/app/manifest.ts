import type { MetadataRoute } from "next";

/**
 * What the platforms read when someone installs Questly.
 *
 * The colours are the literal values `--q-iris` resolves to in
 * `src/app/globals.css`. A manifest is fetched without a document, so there is
 * no stylesheet for a `var()` to resolve against -- these have to be literals,
 * and if the night ground ever moves, it moves here too.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Questly",
    short_name: "Questly",
    description: 'Turns "we should catch up" into a plan, in two taps.',

    /**
     * The app's identity, and the reason it is not simply omitted.
     *
     * With no `id`, the platform derives one from `start_url` -- so the day the
     * start URL moves, every phone with Questly already on it decides the new
     * manifest describes a DIFFERENT app: the installed one stops updating and
     * a second icon can be installed beside it. Pinning it to "/" means the
     * start URL is free to change later. This value must never change.
     */
    id: "/",

    /**
     * Not "/". A landing page is coming to "/" (#9), and someone who has put
     * this on their home screen has already been sold -- launching them into
     * the pitch would be a tax on the people who liked it most. "/start" is
     * the funnel, and it restores an in-progress draft on its own (see
     * `src/lib/funnel.ts`), so a re-launch lands where the last one stopped.
     */
    start_url: "/start",

    /**
     * The whole origin, so a room link and a join link stay inside the
     * installed window. Narrower than this and tapping through to /room/ABCD
     * would eject the user into the browser mid-night, which is the one moment
     * the app exists for.
     */
    scope: "/",

    display: "standalone",
    orientation: "portrait",
    background_color: "#3b3686",
    theme_color: "#3b3686",

    /**
     * Chrome's installability floor is a 192 and a 512; iOS reads the
     * `apple-touch-icon` link instead, which `src/app/apple-icon.png` emits.
     * The maskable copy is a separate file rather than a second `purpose` on
     * the same one: Android crops it to the launcher's shape, so its art is
     * pulled inside the guaranteed centre 80%. See `scripts/generate-icons.sh`.
     */
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],

    /**
     * A second launch focuses the window that is already open rather than
     * opening another one. Two windows on the same live room is two views of
     * one realtime document racing each other, and the user cannot tell which
     * one they are looking at.
     */
    launch_handler: { client_mode: "navigate-existing" },
  };
}
