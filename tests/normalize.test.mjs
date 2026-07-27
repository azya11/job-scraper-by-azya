import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeGreenhouse,
  normalizeLever,
  normalizeAshby,
  normalizeAggregator,
} from "../n8n/code-nodes/normalize.mjs";

test("normalizeGreenhouse maps real Greenhouse job shape", () => {
  const raw = {
    title: "Senior Software Engineer, Backend",
    absolute_url: "https://boards.greenhouse.io/airbnb/jobs/12345",
    location: { name: "Remote - US" },
    updated_at: "2026-07-25T10:00:00Z",
    content: "<p>Build <b>scalable</b> systems.</p>",
  };
  const out = normalizeGreenhouse(raw, "airbnb");
  assert.equal(out.company, "airbnb");
  assert.equal(out.title, "Senior Software Engineer, Backend");
  assert.equal(out.url, "https://boards.greenhouse.io/airbnb/jobs/12345");
  assert.equal(out.location, "Remote - US");
  assert.equal(out.description, "Build scalable systems.");
  assert.equal(out.source, "greenhouse");
});

test("normalizeLever maps real Lever job shape", () => {
  const raw = {
    text: "Fullstack Engineer",
    hostedUrl: "https://jobs.lever.co/palantir/abc-123",
    categories: { team: "Palantir", location: "New York" },
    createdAt: 1721890000000,
    descriptionPlain: "Ship fullstack features end to end.",
    salaryRange: { min: 140000, max: 180000, currency: "USD" },
  };
  const out = normalizeLever(raw);
  assert.equal(out.title, "Fullstack Engineer");
  assert.equal(out.location, "New York");
  assert.equal(out.comp_text, "140000-180000 USD");
  assert.equal(out.source, "lever");
});

test("normalizeAshby maps real Ashby job shape", () => {
  const raw = {
    title: "Software Engineer, Infrastructure",
    jobUrl: "https://jobs.ashbyhq.com/openai/xyz",
    locationName: "San Francisco",
    descriptionPlain: "Work on infra.",
    publishedAt: "2026-07-20T00:00:00Z",
  };
  const out = normalizeAshby(raw, "openai");
  assert.equal(out.company, "openai");
  assert.equal(out.location, "San Francisco");
  assert.equal(out.source, "ashby");
});

test("normalizeAggregator maps Adzuna-shaped result", () => {
  const raw = {
    title: ".NET Developer",
    company: { display_name: "Acme Corp" },
    redirect_url: "https://www.adzuna.com/land/ad/123?utm_source=x",
    location: { display_name: "Austin, TX" },
    salary_min: 90000,
    salary_max: 120000,
    created: "2026-07-24T00:00:00Z",
    description: "Build .NET services.",
  };
  const out = normalizeAggregator(raw);
  assert.equal(out.company, "Acme Corp");
  assert.equal(out.comp_text, "90000-120000");
  assert.equal(out.source, "aggregator");
});
