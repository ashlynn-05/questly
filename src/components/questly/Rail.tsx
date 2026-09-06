/** The route line. Decorative -- it never carries meaning on its own. */
export function Rail({ dashed = false, drawing = false }: { dashed?: boolean; drawing?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={["rail", dashed ? "rail-dashed" : "", drawing ? "rail-draw" : ""].join(" ")}
    />
  );
}

/**
 * Where the line stops.
 *
 * The rail is drawn on the container that wraps the whole list, so it spans
 * every pixel a stop can grow into -- and an open swap sheet on the LAST stop
 * pushed the orange line that sheet's entire height past the final roundel,
 * ending in nothing. This sits in the last row and covers the run below its
 * roundel in the ground the row is painted on. `top` is the roundel's centre.
 */
export function RailEnd({ top }: { top: number }) {
  return <span aria-hidden="true" className="rail-end" style={{ top }} />;
}

/** A stop on the line. Hollow = open, filled = locked, ringed = live. */
export function RailNode({
  top,
  state = "open",
}: {
  top: number;
  state?: "open" | "locked" | "live";
}) {
  return <span aria-hidden="true" className="node" data-state={state} style={{ top }} />;
}
