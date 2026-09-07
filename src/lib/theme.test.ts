import { expect, test } from "vitest";
import { resolveThemeMode, themeScript, THEME_STORAGE_KEY } from "./theme";

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
function runScript(search: string, stored: string | null): string | null {
  let attribute: string | null = null;
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
    },
  };
  new Function("location", "localStorage", "document", themeScript)(
    stubs.location,
    stubs.localStorage,
    stubs.document,
  );
  return attribute;
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
    expect(runScript(search, stored)).toBe(attributeFor(resolveThemeMode(searchValue(search), stored)));
  });
}

/** What `resolveThemeMode` is handed at the call site in `theme.tsx`. */
function searchValue(search: string): string | null {
  return new URLSearchParams(search).get("theme");
}

test("an invalid ?theme= does not suppress the stored choice", () => {
  // Stated separately from the agreement table because it is the product
  // behaviour, not just internal consistency: two agreeing-but-wrong resolvers
  // would pass the table above.
  expect(resolveThemeMode("purple", "dark")).toBe("dark");
  expect(runScript("?theme=purple", "dark")).toBe("dark");
});

test("?theme= wins over the store when it is valid", () => {
  expect(resolveThemeMode("light", "dark")).toBe("light");
  expect(runScript("?theme=light", "dark")).toBe("light");
});

test("nothing anywhere means system, which sets no attribute", () => {
  expect(resolveThemeMode(null, null)).toBe("system");
  expect(runScript("", null)).toBeNull();
});

test("a store the user never wrote is ignored rather than trusted", () => {
  expect(resolveThemeMode(null, "javascript:alert(1)")).toBe("system");
  expect(runScript("", "javascript:alert(1)")).toBeNull();
});
