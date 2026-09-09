import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  GROUND_DARK,
  GROUND_LIGHT,
  resolveThemeMode,
  themeColorFor,
  themeScript,
  THEME_STORAGE_KEY,
} from "../../../src/lib/theme";

/**
 * The bug this file exists to prevent is not "one of these two is wrong". It is
 * "these two disagree" -- the page painted in one mode while the toggle claims
 * the other. So the interesting assertion is not against a hand-written
 * expectation, it is the two implementations against EACH OTHER, over every
 * shape of input either can receive.
 *
 * `themeScript` is a string that runs in a browser before React exists, so it
 * is executed here for real -- `new Function` with a stubbed `location`,
 * `localStorage` and `document` -- rather than paraphrased. Paraphrasing it
 * would test a copy and let the shipped one drift, which is the whole defect.
 */
function runScript(
  search: string,
  stored: string | null,
  prefersLight = false,
): { attribute: string | null; themeColor: string | null } {
  let attribute: string | null = null;

  // The `theme-color` meta the script writes. It creates the element when the
  // document has none, which is the only case that happens in production --
  // the layout ships no meta of its own -- so the stub starts empty.
  let themeColor: string | null = null;
  const meta = {
    setAttribute: (name: string, value: string) => {
      if (name === "content") themeColor = value;
    },
  };
  let appended = false;

  const stubs = {
    location: { search },
    localStorage: {
      getItem: (key: string) => (key === THEME_STORAGE_KEY ? stored : null),
    },
    document: {
      documentElement: {
        setAttribute: (name: string, value: string) => {
          if (name === "data-theme") attribute = value;
        },
      },
      querySelector: () => (appended ? meta : null),
      createElement: () => meta,
      head: {
        appendChild: () => {
          appended = true;
        },
      },
    },
    matchMedia: (query: string) => ({
      matches: query === "(prefers-color-scheme: light)" ? prefersLight : false,
    }),
  };
  new Function("location", "localStorage", "document", "matchMedia", themeScript)(
    stubs.location,
    stubs.localStorage,
    stubs.document,
    stubs.matchMedia,
  );
  return { attribute, themeColor };
}

/** What the script leaves behind for a given mode. "system" sets nothing. */
function attributeFor(mode: ReturnType<typeof resolveThemeMode>): string | null {
  return mode === "system" ? null : mode;
}

const CASES: Array<{ name: string; search: string; stored: string | null }> = [
  { name: "nothing anywhere", search: "", stored: null },
  { name: "a stored choice, no query", search: "", stored: "dark" },
  { name: "a stored light choice, no query", search: "", stored: "light" },
  { name: "the query overriding the store", search: "?theme=light", stored: "dark" },
  { name: "the query agreeing with the store", search: "?theme=dark", stored: "dark" },
  { name: "the query with nothing stored", search: "?theme=dark", stored: null },
  { name: "an empty query value over a store", search: "?theme=", stored: "dark" },
  { name: "an empty query value over nothing", search: "?theme=", stored: null },
  // The regression. `?theme=purple` used to make the script set NOTHING while
  // the toggle read "dark" out of the store -- Day mode with "Night" checked.
  { name: "an invalid query value over a store", search: "?theme=purple", stored: "dark" },
  { name: "an invalid query value over a light store", search: "?theme=PURPLE", stored: "light" },
  { name: "an invalid query value over nothing", search: "?theme=purple", stored: null },
  // Case matters: the attribute and the store are both lowercase.
  { name: "a valid value in the wrong case", search: "?theme=Dark", stored: "light" },
  { name: "junk in the store", search: "", stored: "purple" },
  { name: "the store holding the literal word system", search: "", stored: "system" },
  { name: "another query parameter entirely", search: "?redirect=%2Fstart", stored: "dark" },
];

for (const { name, search, stored } of CASES) {
  test(`the pre-paint script and the toggle agree: ${name}`, () => {
    expect(runScript(search, stored).attribute).toBe(
      attributeFor(resolveThemeMode(searchValue(search), stored)),
    );
  });

  // The same cross-check for the browser's own furniture. It runs over both OS
  // preferences because "system" is the only mode where the preference is
  // consulted at all -- and the mismatch that made this necessary is precisely
  // an explicit choice on a device whose OS says the opposite.
  for (const prefersLight of [false, true]) {
    test(`the bar tint follows the mode (OS prefers ${prefersLight ? "light" : "dark"}): ${name}`, () => {
      expect(runScript(search, stored, prefersLight).themeColor).toBe(
        themeColorFor(resolveThemeMode(searchValue(search), stored), prefersLight),
      );
    });
  }
}

/** What `resolveThemeMode` is handed at the call site in `theme.tsx`. */
function searchValue(search: string): string | null {
  return new URLSearchParams(search).get("theme");
}

/** The script's `data-theme` alone, for the assertions that only care about it. */
function runScriptAttribute(search: string, stored: string | null): string | null {
  return runScript(search, stored).attribute;
}

test("an invalid ?theme= does not suppress the stored choice", () => {
  // Stated separately from the agreement table because it is the product
  // behaviour, not just internal consistency: two agreeing-but-wrong resolvers
  // would pass the table above.
  expect(resolveThemeMode("purple", "dark")).toBe("dark");
  expect(runScriptAttribute("?theme=purple", "dark")).toBe("dark");
});

test("?theme= wins over the store when it is valid", () => {
  expect(resolveThemeMode("light", "dark")).toBe("light");
  expect(runScriptAttribute("?theme=light", "dark")).toBe("light");
});

test("nothing anywhere means system, which sets no attribute", () => {
  expect(resolveThemeMode(null, null)).toBe("system");
  expect(runScriptAttribute("", null)).toBeNull();
});

test("a store the user never wrote is ignored rather than trusted", () => {
  expect(resolveThemeMode(null, "javascript:alert(1)")).toBe("system");
  expect(runScriptAttribute("", "javascript:alert(1)")).toBeNull();
});

/**
 * The other half of the drift problem, in a different direction.
 *
 * `GROUND_DARK` and `GROUND_LIGHT` are literals because a `<meta>` value cannot
 * be a `var()` -- the browser reads the string out of the document with no
 * stylesheet in hand. So the palette now has a copy living outside the
 * stylesheet, and the failure mode is silent: repaint the ground and the phone
 * keeps tinting its status bar with the old colour, which reads as a band
 * across the top of every screen. These two assertions are what makes that a
 * red test instead.
 */
// Read off disk rather than imported: Vitest replaces a CSS import with an
// empty string by default (`test.css` is off), and `?raw` does not get past
// that -- the assertions below would have compared two empty strings and
// passed forever.
const globalsCss = readFileSync(new URL("../../../src/app/globals.css", import.meta.url), "utf8");

function cssVariable(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`).exec(globalsCss);
  if (!match) throw new Error(`--${name} is not declared in globals.css`);
  return match[1].toLowerCase();
}

test("the dark theme-color is still the night ground", () => {
  // `--ground` is `var(--q-iris)` in the :root block; this asserts the value it
  // ultimately resolves to.
  expect(GROUND_DARK.toLowerCase()).toBe(cssVariable("q-iris"));
});

test("the light theme-color is still the day ground", () => {
  expect(GROUND_LIGHT.toLowerCase()).toBe(cssVariable("q-cornsilk"));
});

test("the manifest's colours are the dark ground too", () => {
  // The manifest cannot import from here -- it is a literal file the platform
  // reads at install time -- so this is the reminder that a palette change is
  // a three-file change. Kept as a plain assertion on the constant rather than
  // a parse of manifest.ts, which would test the parser.
  expect(GROUND_DARK).toBe("#3b3686");
});
