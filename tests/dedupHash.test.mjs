import test from "node:test";
import assert from "node:assert/strict";
import { canonicalUrl, jobHash } from "../n8n/code-nodes/dedupHash.mjs";

test("canonicalUrl strips tracking params and trailing slash", () => {
  assert.equal(
    canonicalUrl("https://boards.greenhouse.io/airbnb/jobs/12345?gh_src=abc&utm_source=x"),
    "https://boards.greenhouse.io/airbnb/jobs/12345"
  );
  assert.equal(
    canonicalUrl("https://Boards.Greenhouse.io/airbnb/jobs/12345/"),
    "https://boards.greenhouse.io/airbnb/jobs/12345"
  );
});

test("jobHash is stable for equivalent URLs and differs for different jobs", () => {
  const a = jobHash("https://jobs.lever.co/palantir/abc-123?ref=li");
  const b = jobHash("https://jobs.lever.co/palantir/abc-123");
  const c = jobHash("https://jobs.lever.co/palantir/def-456");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a.length, 64); // sha256 hex
});

test("jobHash tolerates malformed URLs without throwing", () => {
  assert.doesNotThrow(() => jobHash("not a url"));
});
