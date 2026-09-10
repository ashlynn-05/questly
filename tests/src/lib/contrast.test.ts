import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * The ratios written in `src/` are load-bearing, and nothing checked them.
 *
 * WCAG 2.2 AA is a product requirement here and the palette is full of traps:
 * apricot carries text at night and vanishes by day, the orange field cannot
 * move because the ink on it has no headroom, and half a dozen tokens sit one
 * hundredth above or below a threshold. So every colour decision in this
 * codebase is written down as a measured ratio in the comment beside it, and
 * those comments are how the next person decides whether a change is safe.
 *
 * They are prose, though: nothing recomputes them, and a token can move
 * underneath one years later without a single test going red.
 *
 * This file makes them executable. Every ratio written anywhere in `src/` must
 * appear in the registry below, and every entry in the registry is recomputed
 * from the token values parsed out of `globals.css`. Write a new ratio in a
 * comment and this file fails until you register it; register it wrong and it
 * fails until the arithmetic agrees; move a token and every claim that rests on
 * it fails at once.
 */

// ---------------------------------------------------------------------------
// The measurement, per WCAG 2.x. Anchored against the spec's own worked
// examples below rather than against this palette, so a mistake in the formula
// cannot be absorbed by expectations derived from the same mistake.
// ---------------------------------------------------------------------------

/** An sRGB colour as three 0-1 channels. Not 8-bit: see `over`. */
type Rgb = readonly [number, number, number];

function parseHex(hex: string): Rgb {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

function relativeLuminance(c: Rgb): number {
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * `fg` drawn at `alpha` over `bg` -- what CSS `opacity` actually produces.
 *
 * Quantised back to 8 bits per channel, because that is what a browser does: an
 * element with `opacity` is rendered into an sRGB buffer and composited from
 * it, so the colour a person actually sees is the rounded one. This is not a
 * detail -- it moves the opacity ratios below by a hundredth each, and this
 * file exists precisely because a hundredth can sit on a threshold. Round half
 * UP, as the pipeline does; round half to even instead and two of them come out
 * a hundredth low.
 */
function over(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return [0, 1, 2].map(
    (i) => Math.round((fg[i] * alpha + bg[i] * (1 - alpha)) * 255) / 255,
  ) as unknown as Rgb;
}

/** The written form: two decimal places, which is the convention in `src/`. */
function written(r: number): string {
  return r.toFixed(2);
}

describe("the measurement itself", () => {
  test("black on white is the maximum 21:1", () => {
    expect(written(ratio(parseHex("#000000"), parseHex("#ffffff")))).toBe("21.00");
  });

  test("a colour against itself is 1:1", () => {
    expect(written(ratio(parseHex("#3b3686"), parseHex("#3b3686")))).toBe("1.00");
  });

  test("WCAG's own worked example: #777777 on white is 4.48:1", () => {
    expect(written(ratio(parseHex("#777777"), parseHex("#ffffff")))).toBe("4.48");
  });

  test("order does not matter", () => {
    const a = parseHex("#e0652b");
    const b = parseHex("#3b3686");
    expect(ratio(a, b)).toBe(ratio(b, a));
  });

  test("half opacity lands halfway between the two colours", () => {
    // 127.5 is not a colour a browser can store, so it lands on 128/255.
    const half = 128 / 255;
    expect(over(parseHex("#000000"), 0.5, parseHex("#ffffff"))).toEqual([half, half, half]);
  });
});

// ---------------------------------------------------------------------------
// The tokens, read from globals.css. Not copied here: a copy would drift, and
// drift is the failure this file exists to prevent.
// ---------------------------------------------------------------------------

const SRC = join(process.cwd(), "src");
const CSS = readFileSync(join(SRC, "app", "globals.css"), "utf8");

/** The body of the first `{ ... }` after `selector`, brace-matched. */
function block(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`globals.css no longer has a ${selector} block`);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(start, i);
  }
  throw new Error(`unbalanced braces after ${selector}`);
}

/**
 * Custom-property declarations in one block, with `var(--x)` chains resolved
 * against `inherited` -- so `--accent: var(--q-apricot)` lands as a hex and a
 * ratio below breaks the day the brand repaints apricot.
 */
function tokens(body: string, inherited: Record<string, string> = {}): Record<string, string> {
  const out = { ...inherited };
  for (const [, name, value] of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    out[name] = value.trim();
  }
  for (const name of Object.keys(out)) {
    let seen = 0;
    while (out[name].startsWith("var(")) {
      const ref = out[name].slice(4, out[name].indexOf(")")).replace("--", "");
      if (++seen > 10) throw new Error(`--${name} resolves in a circle`);
      out[name] = out[ref];
    }
  }
  return out;
}

const DARK_TOKENS = tokens(block(CSS, ":root {"));
const LIGHT_TOKENS = tokens(block(CSS, ':root[data-theme="light"]'), DARK_TOKENS);

/** One mode's roles, as colours ready to measure. */
function mode(t: Record<string, string>) {
  const get = (name: string): Rgb => {
    const value = t[name];
    if (!value || !value.startsWith("#")) {
      throw new Error(`--${name} is ${value ?? "missing"}, not a hex colour`);
    }
    return parseHex(value);
  };
  return {
    ground: get("ground"),
    groundDeep: get("ground-deep"),
    groundRaised: get("ground-raised"),
    text: get("text"),
    textDim: get("text-dim"),
    accent: get("accent"),
    action: get("action"),
    actionQuiet: get("action-quiet"),
    actionEdge: get("action-edge"),
    onAction: get("on-action"),
    rail: get("rail"),
    hairline: get("hairline"),
    danger: get("danger"),
  };
}

const D = mode(DARK_TOKENS);
const L = mode(LIGHT_TOKENS);

/** Colours from outside the palette, named where they are claimed. */
const NEUTRAL_900 = parseHex("#171717"); // Tailwind, via Create-Next-App
const NEUTRAL_600 = parseHex("#525252");
const NEUTRAL_300 = parseHex("#d4d4d4");

/** Half opacity, the treatment this project bans on controls. */
const HALF = 0.5;

// ---------------------------------------------------------------------------
// The registry.
// ---------------------------------------------------------------------------

type Claim = { ratio: string; of: string; measure: () => number };

const CLAIMS: Claim[] = [
  // Text on the page ground.
  { ratio: "10.20", of: "--text on --ground, dark", measure: () => ratio(D.text, D.ground) },
  { ratio: "15.97", of: "--text on --ground, light", measure: () => ratio(L.text, L.ground) },
  { ratio: "5.26", of: "--text-dim on --ground, dark", measure: () => ratio(D.textDim, D.ground) },
  { ratio: "6.21", of: "--text-dim on --ground, light", measure: () => ratio(L.textDim, L.ground) },

  // The accent role, and why it swaps.
  { ratio: "5.68", of: "apricot on iris", measure: () => ratio(D.accent, D.ground) },
  { ratio: "9.57", of: "iris on cornsilk", measure: () => ratio(L.accent, L.ground) },
  {
    ratio: "1.68",
    of: "apricot on cornsilk -- the reason the accent role swaps",
    measure: () => ratio(D.accent, L.ground),
  },

  // The orange field, and the edge that rescues it.
  { ratio: "2.95", of: "--action fill on --ground, dark", measure: () => ratio(D.action, D.ground) },
  { ratio: "3.25", of: "--action fill on --ground, light", measure: () => ratio(L.action, L.ground) },
  {
    ratio: "4.92",
    of: "--on-action on --action, the same in both modes",
    measure: () => ratio(D.onAction, D.action),
  },
  {
    ratio: "3.46",
    of: "the white edge against the orange fill, dark",
    measure: () => ratio(D.actionEdge, D.action),
  },
  {
    ratio: "1.32",
    of: "deep orange against the orange fill -- why the edge is not an orange",
    measure: () => ratio(D.actionQuiet, D.action),
  },
  {
    ratio: "2.45",
    of: "deep orange on cornsilk -- the same failure by day",
    measure: () => ratio(D.actionQuiet, L.ground),
  },
  {
    ratio: "3.90",
    of: "deep orange on iris -- already clears 3:1",
    measure: () => ratio(D.actionQuiet, D.ground),
  },
  {
    ratio: "1.38",
    of: "jonquil, light's quiet action, on cornsilk",
    measure: () => ratio(L.actionQuiet, L.ground),
  },
  {
    ratio: "11.58",
    of: "the ink edge against the jonquil fill",
    measure: () => ratio(L.actionEdge, L.actionQuiet),
  },

  // Line work, which is decorative and says so.
  { ratio: "2.77", of: "--rail on --ground, dark", measure: () => ratio(D.rail, D.ground) },
  { ratio: "1.44", of: "--hairline on --ground, dark", measure: () => ratio(D.hairline, D.ground) },
  { ratio: "1.39", of: "--hairline on --ground, light", measure: () => ratio(L.hairline, L.ground) },

  { ratio: "5.03", of: "--danger on --ground, dark", measure: () => ratio(D.danger, D.ground) },
  { ratio: "6.30", of: "--danger on --ground, light", measure: () => ratio(L.danger, L.ground) },

  // The raised surface: its own numbers, not the ground's carried over.
  {
    ratio: "4.52",
    of: "--text-dim on --ground-raised, dark",
    measure: () => ratio(D.textDim, D.groundRaised),
  },
  {
    ratio: "5.24",
    of: "--text-dim on --ground-raised, light",
    measure: () => ratio(L.textDim, L.groundRaised),
  },

  // --text-dim over an orange field: the pairing that has no safe token.
  { ratio: "1.79", of: "--text-dim on --action, dark", measure: () => ratio(D.textDim, D.action) },
  {
    ratio: "1.35",
    of: "--text-dim on --action-quiet, dark",
    measure: () => ratio(D.textDim, D.actionQuiet),
  },
  { ratio: "1.91", of: "--text-dim on --action, light", measure: () => ratio(L.textDim, L.action) },
  {
    ratio: "4.50",
    of: "--text-dim on --action-quiet, light",
    measure: () => ratio(L.textDim, L.actionQuiet),
  },

  // What half opacity does, which is why this project bans it on controls.
  // CSS `opacity` composites the WHOLE element over the page, so every layer of
  // the control is measured against the ground showing through it.
  {
    ratio: "2.49",
    of: "--accent at 50% over --ground, dark",
    measure: () => ratio(over(D.accent, HALF, D.ground), D.ground),
  },
  {
    ratio: "2.63",
    of: "--accent at 50% over --ground, light",
    measure: () => ratio(over(L.accent, HALF, L.ground), L.ground),
  },
  {
    ratio: "2.17",
    of: "a 50% action Plate's label against its own fill, dark",
    measure: () => ratio(over(D.onAction, HALF, D.ground), over(D.action, HALF, D.ground)),
  },
  {
    ratio: "1.86",
    of: "the same label against the same fill, light",
    measure: () => ratio(over(L.onAction, HALF, L.ground), over(L.action, HALF, L.ground)),
  },
  {
    ratio: "1.64",
    of: "a 50% action Plate's fill against the ground, dark",
    measure: () => ratio(over(D.action, HALF, D.ground), D.ground),
  },
  {
    ratio: "2.34",
    of: "a 50% action Plate's edge against its own fill, dark",
    measure: () => ratio(over(D.actionEdge, HALF, D.ground), over(D.action, HALF, D.ground)),
  },

  // The Create-Next-App greys the auth pages shipped in. Kept measured because
  // the comment that names them is the argument for never bringing them back.
  {
    ratio: "1.05",
    of: "text-neutral-900 on --ground-deep, dark",
    measure: () => ratio(NEUTRAL_900, D.groundDeep),
  },
  {
    ratio: "2.18",
    of: "text-neutral-600 on --ground-deep, dark",
    measure: () => ratio(NEUTRAL_600, D.groundDeep),
  },
  {
    ratio: "1.09",
    of: "border-neutral-300 on --ground-deep, light",
    measure: () => ratio(NEUTRAL_300, L.groundDeep),
  },
];

describe("every contrast ratio this codebase writes down", () => {
  test.each(CLAIMS)("$ratio:1 -- $of", ({ ratio: claimed, measure }) => {
    expect(written(measure())).toBe(claimed);
  });
});

// ---------------------------------------------------------------------------
// The guard: no ratio may be written in src/ without being registered above.
// ---------------------------------------------------------------------------

/**
 * A measured ratio is written to two decimal places; a WCAG threshold is
 * written as `3:1`, `4.5:1` or `7:1`. That convention is what separates a claim
 * about this palette from a citation of the standard, so the pattern below
 * deliberately requires exactly two decimals.
 */
const CLAIM_PATTERN = /(\d+\.\d{2}):1/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|css)$/.test(path) ? [path] : [];
  });
}

const WRITTEN_IN_SRC = new Map<string, string[]>();
for (const path of sourceFiles(SRC)) {
  for (const [, value] of readFileSync(path, "utf8").matchAll(CLAIM_PATTERN)) {
    WRITTEN_IN_SRC.set(value, [...(WRITTEN_IN_SRC.get(value) ?? []), path]);
  }
}

describe("the registry and the codebase agree", () => {
  test("src/ writes ratios at all, so the scan cannot pass vacuously", () => {
    expect(WRITTEN_IN_SRC.size).toBeGreaterThan(30);
  });

  test("every ratio written in src/ is registered and recomputed above", () => {
    const registered = new Set(CLAIMS.map((c) => c.ratio));
    const unregistered = [...WRITTEN_IN_SRC.entries()]
      .filter(([value]) => !registered.has(value))
      .map(([value, files]) => `${value}:1 in ${files.join(", ")}`);
    expect(unregistered).toEqual([]);
  });

  test("every registered ratio is one the codebase actually writes", () => {
    const stale = CLAIMS.filter((c) => !WRITTEN_IN_SRC.has(c.ratio)).map(
      (c) => `${c.ratio}:1 (${c.of})`,
    );
    expect(stale).toEqual([]);
  });
});
