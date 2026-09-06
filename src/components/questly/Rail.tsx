/** The route line. Decorative -- it never carries meaning on its own. */
export function Rail({ dashed = false, drawing = false }: { dashed?: boolean; drawing?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={["rail", dashed ? "rail-dashed" : "", drawing ? "rail-draw" : ""].join(" ")}
    />
  );
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
