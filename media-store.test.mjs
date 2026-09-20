import test from "node:test";
import assert from "node:assert/strict";
import { deterministicId, normalizeRecord, SOURCES } from "./media-store.mjs";
test("legacy records receive stable ids", () => {
  const source = SOURCES[0];
  const a = normalizeRecord({ t: "title", a: "author" }, source, 2);
  const b = normalizeRecord({ t: "title", a: "author" }, source, 2);
  assert.equal(a.id, b.id);
  assert.equal(a.type, "book");
});
test("different source/index values do not collide", () => {
  assert.notEqual(deterministicId({ title: "x" }, SOURCES[0], 0), deterministicId({ title: "x" }, SOURCES[1], 0));
});
