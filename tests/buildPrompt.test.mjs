import test from "node:test";
import assert from "node:assert/strict";
import { loadProfile, buildSystemPrompt, buildUserPrompt } from "../prompts/build-prompt.mjs";

const CAREER_OPS_PROFILE = "C:\\Users\\Aziz Shamuratov\\Desktop\\career-ops\\config\\profile.yml";

test("loads the real profile.yml and includes real proof points, not fabricated ones", () => {
  const profile = loadProfile(CAREER_OPS_PROFILE);
  const prompt = buildSystemPrompt(profile);
  assert.match(prompt, /Aziz Shamuratov/);
  assert.match(prompt, /mapgen/);
  assert.match(prompt, /Itransition internship/);
  assert.match(prompt, /\$80K-120K/);
  // must NOT contain the fabricated resume from the pasted third-party manual
  assert.doesNotMatch(prompt, /500k daily active users/);
});

test("prompt states the real score bands", () => {
  const profile = loadProfile(CAREER_OPS_PROFILE);
  const prompt = buildSystemPrompt(profile);
  assert.match(prompt, /4\.5\+ -> Strong match/);
  assert.match(prompt, /Below 3\.5 -> Recommend against applying/);
});

test("buildUserPrompt embeds job fields", () => {
  const userPrompt = buildUserPrompt({
    company: "GitLab",
    title: "AI Engineer",
    location: "Remote, US",
    source: "greenhouse",
    comp_text: "",
    url: "https://job-boards.greenhouse.io/gitlab/jobs/8565469002",
    description: "Build AI tooling for DevSecOps.",
  });
  assert.match(userPrompt, /GitLab/);
  assert.match(userPrompt, /AI Engineer/);
  assert.match(userPrompt, /Build AI tooling/);
});
