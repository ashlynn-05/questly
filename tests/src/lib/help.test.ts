import { describe, expect, it } from "vitest";
import { PURGE_WINDOW_DAYS } from "@convex/lib/account";
import { MAX_AVATAR_MB } from "@convex/lib/avatar";
import { HELP, HELP_TOPICS, type HelpTopic } from "../../../src/lib/help";

/**
 * Help copy is data, so it is checked like data.
 *
 * The two tests that matter are the last two. Moving an explanation behind a
 * question mark means nobody sees it during ordinary use of the screen, so the
 * day the purge window or the upload cap changes in `convex/lib/`, the sentence
 * that quotes it goes quietly wrong and stays wrong. These pin the copy to the
 * constants the backend actually enforces rather than to a number somebody
 * typed once.
 */
describe("the help catalog", () => {
  it("gives every topic a title and something to say", () => {
    for (const topic of HELP_TOPICS) {
      const entry = HELP[topic];
      expect(entry.title.trim(), topic).not.toBe("");
      expect(entry.body.length, topic).toBeGreaterThan(0);
      for (const paragraph of entry.body) {
        expect(paragraph.trim(), topic).not.toBe("");
      }
    }
  });

  it("has a distinct title per topic, because the title is the dialog's name", () => {
    const titles = HELP_TOPICS.map((topic) => HELP[topic].title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("keeps every topic reachable through the exported list", () => {
    // `HELP_TOPICS` is a cast, so it is the one place a new entry can be added
    // to the record and silently left out of anything that iterates it.
    expect(HELP_TOPICS.sort()).toEqual((Object.keys(HELP) as HelpTopic[]).sort());
  });

  it("states the purge window the backend enforces", () => {
    expect(HELP.deletion.body.join(" ")).toContain(`${PURGE_WINDOW_DAYS} days`);
  });

  it("states the upload cap the backend enforces", () => {
    expect(HELP.picture.body.join(" ")).toContain(`${MAX_AVATAR_MB}MB`);
  });
});
