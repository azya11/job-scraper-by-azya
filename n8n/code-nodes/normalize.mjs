// Pure normalization functions — one per source shape — mapping each ATS's
// raw JSON into the common job schema used downstream:
//   { company, title, url, location, comp_text, posted_at, description, source }
//
// Kept as plain, testable functions. The n8n Code node body just imports/
// inlines these and calls the right one based on which HTTP node produced
// the item (see n8n/code-nodes/README.md).

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripHtml(html) {
  if (!html) return "";
  // Some ATSes (Greenhouse included) double-encode: the JSON string is
  // itself HTML-escaped markup, so tags only appear after one decode pass.
  let text = decodeEntities(html);
  text = text
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return decodeEntities(text);
}

export function normalizeGreenhouse(job, companyName) {
  return {
    company: companyName || job.company_name || "Unknown",
    title: job.title,
    url: job.absolute_url,
    location: job.location?.name || "Remote/Unspecified",
    comp_text: "",
    posted_at: job.updated_at || null,
    description: stripHtml(job.content),
    source: "greenhouse",
  };
}

export function normalizeLever(job, companyName) {
  return {
    company: companyName || job.categories?.team || "Unknown",
    title: job.text,
    url: job.hostedUrl,
    location: job.categories?.location || "Remote/Unspecified",
    comp_text: job.salaryRange
      ? `${job.salaryRange.min ?? ""}-${job.salaryRange.max ?? ""} ${job.salaryRange.currency ?? ""}`.trim()
      : "",
    posted_at: job.createdAt ? new Date(job.createdAt).toISOString() : null,
    description: stripHtml(job.descriptionPlain || job.description),
    source: "lever",
  };
}

export function normalizeAshby(job, companyName) {
  return {
    company: companyName || "Unknown",
    title: job.title,
    url: job.jobUrl,
    location: job.locationName || "Remote/Unspecified",
    comp_text: job.compensation?.summary || "",
    posted_at: job.publishedAt || null,
    description: stripHtml(job.descriptionPlain || job.description),
    source: "ashby",
  };
}

export function normalizeAggregator(job) {
  // Adzuna/JSearch-shaped result — field names vary slightly by vendor;
  // this covers Adzuna's shape (title, company.display_name, redirect_url,
  // location.display_name, salary_min/max, created, description).
  return {
    company: job.company?.display_name || job.company_name || job.employer_name || "Unknown",
    title: job.title || job.job_title,
    url: job.redirect_url || job.job_apply_link || job.url,
    location: job.location?.display_name || job.job_city || "Remote/Unspecified",
    comp_text:
      job.salary_min || job.salary_max
        ? `${job.salary_min ?? ""}-${job.salary_max ?? ""}`
        : job.job_min_salary
        ? `${job.job_min_salary}-${job.job_max_salary ?? ""}`
        : "",
    posted_at: job.created || job.job_posted_at_datetime_utc || null,
    description: stripHtml(job.description || job.job_description),
    source: "aggregator",
  };
}

export function normalizeManualInbox(row) {
  return {
    company: "",
    title: "",
    url: row.url,
    location: "",
    comp_text: "",
    posted_at: row.added_at || null,
    description: "",
    source: "manual_inbox",
    note: row.note || "",
  };
}
