import { readFileSync } from "node:fs";
import { load as loadYaml } from "js-yaml";
import { pathToFileURL } from "node:url";

// Builds the Claude evaluation prompt from the candidate's REAL
// career-ops/config/profile.yml — never a fabricated resume. Mirrors
// career-ops' actual scoring rubric (modes/_shared.md "Scoring System"):
// Blocks A-F (Match CV, North Star alignment, Comp, Cultural signals,
// Red flags, weighted Global 1-5) plus Block G posting legitimacy as a
// separate qualitative tier that does NOT affect the global score.
//
// Usage (standalone): node prompts/build-prompt.mjs <path-to-profile.yml>
// Usage (n8n): import buildSystemPrompt/buildUserPrompt and call with the
// profile object loaded once at workflow start (Set node / static data),
// not re-read from disk per job.

export function loadProfile(path) {
  return loadYaml(readFileSync(path, "utf8"));
}

export function buildSystemPrompt(profile) {
  const c = profile.candidate || {};
  const roles = profile.target_roles || {};
  const narrative = profile.narrative || {};
  const comp = profile.compensation || {};
  const loc = profile.location || {};

  const archetypes = (roles.archetypes || [])
    .map((a) => `  - ${a.name} (${a.level}, fit: ${a.fit})`)
    .join("\n");

  const proofPoints = (narrative.proof_points || [])
    .map((p) => `  - ${p.name}: ${p.hero_metric}`)
    .join("\n");

  const superpowers = (narrative.superpowers || []).map((s) => `  - ${s}`).join("\n");

  return `You are an automated job-fit evaluator for a job search pipeline. You score every posting exactly the way the career-ops CLI framework does — do not invent a different rubric.

CANDIDATE PROFILE (from profile.yml — treat as ground truth, never invent experience beyond this):
Name: ${c.full_name}
Location: ${loc.city}, ${loc.country} (${loc.timezone}) — visa: ${loc.visa_status}
Headline: ${narrative.headline}
Exit story: ${narrative.exit_story}

Target roles (primary/North Star):
${(roles.primary || []).map((r) => `  - ${r}`).join("\n")}

Archetypes (fit levels):
${archetypes}

Superpowers:
${superpowers}

Proof points (real, verifiable — do not exceed these when describing the candidate's experience):
${proofPoints}

Compensation target: ${comp.target_range} ${comp.currency} (walk-away minimum: ${comp.minimum}). Flexibility: ${comp.location_flexibility}

SCORING RUBRIC (career-ops Blocks A-F + G — score each 1.0-5.0, half points allowed):
1. Match with CV — skills, experience, and proof-point alignment against the JD's actual requirements. Never invent experience or metrics to inflate this.
2. North Star alignment — how well the role fits the archetypes above (primary fit scores higher than adjacent/stretch fits).
3. Comp — salary vs. market for this role/level/location (5 = top quartile, 1 = well below target range). If the JD publishes no salary, classify company type and compensation reliability tier (High/Medium/Low/Unknown) instead of estimating a number.
4. Cultural signals — company culture, growth trajectory, stability, remote policy, evidenced by the JD text (not guessed).
5. Red flags — blockers/warnings as a negative adjustment (vague requirements, contradictory asks, concerning JD language, recent layoffs if evident from the text given).
6. Global — the weighted average of the above five, 1.0-5.0.

Score interpretation (use these exact bands):
- 4.5+ -> Strong match, recommend applying immediately
- 4.0-4.4 -> Good match, worth applying
- 3.5-3.9 -> Decent but not ideal, apply only if specific reason
- Below 3.5 -> Recommend against applying

Block G — Posting legitimacy (qualitative only, does NOT affect the global score): classify as "high_confidence", "proceed_with_caution", or "suspicious" based on signals actually present in the JD text (specificity, realistic requirements, salary transparency) — never accuse the poster of dishonesty, just note signals.

NEVER invent experience or metrics beyond the proof points given. NEVER recommend a comp below the candidate's stated minimum without flagging it as below target.

Respond with ONLY a single JSON object (no markdown fence, no commentary) matching exactly this shape:
{
  "archetype": string,
  "role_summary": string,
  "match_cv_score": number,
  "match_cv_notes": string,
  "north_star_score": number,
  "north_star_notes": string,
  "comp_score": number,
  "comp_notes": string,
  "cultural_score": number,
  "cultural_notes": string,
  "red_flags_score": number,
  "red_flags_notes": string,
  "global_score": number,
  "posting_legitimacy": "high_confidence" | "proceed_with_caution" | "suspicious",
  "posting_legitimacy_notes": string,
  "recommend_apply": boolean
}`;
}

export function buildUserPrompt(job) {
  return `Evaluate this job posting.

Company: ${job.company}
Title: ${job.title}
Location: ${job.location}
Source: ${job.source}
Compensation (as advertised, if any): ${job.comp_text || "not stated"}
URL: ${job.url}

Job description:
${job.description}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const profilePath = process.argv[2];
  if (!profilePath) {
    console.error("Usage: node prompts/build-prompt.mjs <path-to-profile.yml>");
    process.exit(1);
  }
  const profile = loadProfile(profilePath);
  console.log(buildSystemPrompt(profile));
}
