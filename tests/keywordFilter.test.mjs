import test from "node:test";
import assert from "node:assert/strict";
import { isTargetRole } from "../n8n/code-nodes/keywordFilter.mjs";

test("matches direct target titles", () => {
  assert.ok(isTargetRole("Senior Software Engineer, Backend"));
  assert.ok(isTargetRole("Software Developer II"));
  assert.ok(isTargetRole(".NET Developer"));
  assert.ok(isTargetRole("Fullstack Engineer"));
  assert.ok(isTargetRole("Full Stack Developer"));
  assert.ok(isTargetRole("ML Engineer"));
  assert.ok(isTargetRole("Machine Learning Engineer, Platform"));
});

test("rejects clearly unrelated titles", () => {
  assert.equal(isTargetRole("Product Marketing Manager"), false);
  assert.equal(isTargetRole("Sales Development Representative"), false);
  assert.equal(isTargetRole("Executive Assistant"), false);
});

test("falls back to description for generic titles", () => {
  assert.ok(isTargetRole("Engineer II", "You will work as a Software Engineer on backend systems."));
  assert.equal(isTargetRole("Engineer II", "You will support marketing campaigns."), false);
});
