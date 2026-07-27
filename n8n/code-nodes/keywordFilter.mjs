// Target-role keyword gate, built from career-ops/config/profile.yml
// target_roles.primary plus the explicit synonyms requested for this
// pipeline (.NET Developer, Fullstack Engineer, Software Developer).
// Kept as one regex so it's trivial to extend when profile.yml changes.

export const TARGET_ROLE_PATTERN =
  /(software\s*(developer|engineer)|backend\s*(developer|engineer)|full[\s-]?stack\s*(developer|engineer)|\.net\s*(developer|engineer)|ml\s*engineer|machine\s*learning\s*engineer|ai\s*engineer)/i;

export function isTargetRole(title, description = "") {
  if (TARGET_ROLE_PATTERN.test(title || "")) return true;
  // Fall back to description only when the title is generic/unhelpful
  // (some ATS postings title jobs just "Engineer" or "SWE II").
  if (/^(engineer|swe|developer)\b/i.test((title || "").trim())) {
    return TARGET_ROLE_PATTERN.test(description || "");
  }
  return false;
}
