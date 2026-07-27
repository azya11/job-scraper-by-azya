#!/usr/bin/env node
// Extracts the jsCode string verbatim from each n8n workflow's Code nodes
// and runs it in a harness that mocks n8n's $input/$('NodeName') API,
// against REAL live API responses — so the exact code that will run
// inside n8n gets exercised, not just the standalone tested modules it
// was copied from.

import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function getNode(workflow, name) {
  const node = workflow.nodes.find((n) => n.name === name);
  if (!node) throw new Error(`Node not found: ${name}`);
  return node;
}

function runCodeNode(jsCode, { inputItem, namedNodes = {} }) {
  const sandbox = {
    require,
    console,
    $input: { item: { json: inputItem } },
    $: (name) => {
      if (!(name in namedNodes)) throw new Error(`Unmocked $('${name}') reference`);
      return { item: { json: namedNodes[name] } };
    },
    Buffer,
  };
  vm.createContext(sandbox);
  const wrapped = `(function(){ ${jsCode} })()`;
  return vm.runInContext(wrapped, sandbox);
}

async function main() {
  const ats = JSON.parse(readFileSync(new URL("../n8n/workflows/ingestion-ats.json", import.meta.url)));
  const normalizeNode = getNode(ats, "Normalize");

  console.log("=== Validating inlined Greenhouse normalizer against live gitlab board ===");
  const ghRes = await fetch("https://boards-api.greenhouse.io/v1/boards/gitlab/jobs?content=true");
  const ghData = await ghRes.json();
  const out1 = runCodeNode(normalizeNode.parameters.jsCode, {
    inputItem: ghData,
    namedNodes: { "Load active ATS sources": { ats_type: "greenhouse", identifier: "gitlab", company_name: "GitLab" } },
  });
  console.log(`  Normalized ${out1.length} jobs. Sample:`, JSON.stringify(out1[0], null, 2).slice(0, 300));
  if (out1.length === 0) throw new Error("Greenhouse inline normalizer produced 0 jobs");

  console.log("=== Validating inlined Lever normalizer against live palantir board ===");
  const leverRes = await fetch("https://api.lever.co/v0/postings/palantir?mode=json");
  const leverData = await leverRes.json();
  const out2 = runCodeNode(normalizeNode.parameters.jsCode, {
    inputItem: leverData,
    namedNodes: { "Load active ATS sources": { ats_type: "lever", identifier: "palantir", company_name: "Palantir" } },
  });
  console.log(`  Normalized ${out2.length} jobs. Sample:`, JSON.stringify(out2[0], null, 2).slice(0, 300));
  if (out2.length === 0) throw new Error("Lever inline normalizer produced 0 jobs");

  console.log("=== Validating inlined Ashby normalizer against live openai board ===");
  const ashbyRes = await fetch("https://api.ashbyhq.com/posting-api/job-board/openai");
  const ashbyData = await ashbyRes.json();
  const out3 = runCodeNode(normalizeNode.parameters.jsCode, {
    inputItem: ashbyData,
    namedNodes: { "Load active ATS sources": { ats_type: "ashby", identifier: "openai", company_name: "OpenAI" } },
  });
  console.log(`  Normalized ${out3.length} jobs. Sample:`, JSON.stringify(out3[0], null, 2).slice(0, 300));
  if (out3.length === 0) throw new Error("Ashby inline normalizer produced 0 jobs");

  console.log("=== Validating inlined keyword gate + hash from main-orchestrator ===");
  const orch = JSON.parse(readFileSync(new URL("../n8n/workflows/main-orchestrator.json", import.meta.url)));
  const gateNode = getNode(orch, "Keyword gate");
  const hashNode = getNode(orch, "Compute job_hash");

  const passJob = { title: "Software Engineer", description: "", source_platform: "greenhouse", url: "https://example.com/a" };
  const failJob = { title: "Product Marketing Manager", description: "", source_platform: "greenhouse", url: "https://example.com/b" };
  const manualJob = { title: "", description: "", source_platform: "manual_inbox", url: "https://example.com/c" };

  const gatePass = runCodeNode(gateNode.parameters.jsCode, { inputItem: passJob });
  const gateFail = runCodeNode(gateNode.parameters.jsCode, { inputItem: failJob });
  const gateManual = runCodeNode(gateNode.parameters.jsCode, { inputItem: manualJob });
  if (gatePass.length !== 1) throw new Error("Keyword gate wrongly dropped a target-role job");
  if (gateFail.length !== 0) throw new Error("Keyword gate wrongly kept a non-target job");
  if (gateManual.length !== 1) throw new Error("Keyword gate wrongly dropped a manual_inbox entry");
  console.log("  Keyword gate: pass/fail/manual-bypass all correct");

  const hashed = runCodeNode(hashNode.parameters.jsCode, { inputItem: { url: "https://example.com/a?utm=1", title: "x" } });
  if (!hashed[0].json.job_hash || hashed[0].json.job_hash.length !== 64) {
    throw new Error("job_hash computation failed");
  }
  console.log("  job_hash computation: OK (sha256, 64 hex chars)");

  console.log("=== Validating Telegram HTML escaping in evaluate-job.json against an adversarial job ===");
  const evalWorkflow = JSON.parse(readFileSync(new URL("../n8n/workflows/evaluate-job.json", import.meta.url)));
  const parseResultNode = getNode(evalWorkflow, "Parse Claude result");
  const maliciousJob = {
    company: '<a href="http://evil.example/phish">Acme</a>',
    title: "<script>alert(1)</script> Software Engineer",
    location: "Remote",
    url: "https://example.com/job/1",
    description: "irrelevant",
  };
  const claudeResponse = {
    content: [
      {
        text: JSON.stringify({
          archetype: "Software Engineer",
          global_score: 4.2,
          match_cv_score: 4,
          match_cv_notes: "ok",
          north_star_score: 4,
          north_star_notes: "ok",
          comp_score: 4,
          comp_notes: "ok",
          cultural_score: 4,
          cultural_notes: "ok",
          red_flags_score: 5,
          red_flags_notes: "ok",
          posting_legitimacy: "high_confidence",
          posting_legitimacy_notes: "ok",
          recommend_apply: true,
        }),
      },
    ],
  };
  const parsed = runCodeNode(parseResultNode.parameters.jsCode, {
    inputItem: claudeResponse,
    namedNodes: { "When Called (one job)": maliciousJob },
  });
  const cardHtml = parsed[0].json.telegram_card_html;
  if (cardHtml.includes("<a href=") || cardHtml.includes("<script>")) {
    throw new Error("HTML injection NOT escaped in telegram_card_html: " + cardHtml);
  }
  if (!cardHtml.includes("&lt;a href=") || !cardHtml.includes("&lt;script&gt;")) {
    throw new Error("Expected escaped entities not found in telegram_card_html: " + cardHtml);
  }
  console.log("  Malicious company/title correctly HTML-escaped in the Telegram card, no live tags survived.");

  console.log("\nAll inline n8n Code node logic validated against live data + edge cases.");
}

main().catch((e) => {
  console.error("VALIDATION FAILED:", e.message);
  process.exit(1);
});
