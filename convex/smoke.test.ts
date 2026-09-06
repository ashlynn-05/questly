/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("the harness can query a Convex function", async () => {
  const t = convexTest(schema, modules);
  const events = await t.query(api.events.list, {});
  expect(events).toEqual([]);
});
