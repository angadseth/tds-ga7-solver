/**
 * Offline verification: run the engine against the vendored bundle in Node and
 * assert the answers it derives match answers that were confirmed by the exam.
 *
 *   node tools/verify.mjs
 */
import fs from "node:fs";

import path from "node:path";
import { pathToFileURL } from "node:url";
import { patch, solveOffline } from "../assets/engine.js";

const EMAIL = process.env.TDS_EMAIL || "24f2004141@ds.study.iitm.ac.in";

/** Answers this exam accepted, used as ground truth for the engine. */
const EXPECTED = {
  "q-cloudflare-waf-bypass": "19|req-15|21",
  "q-media-forensics": "TDS-051BB9|6f3d7c40|6",
  "q-actions-workflow-audit": "W1,W2,W4,W6|pr-artifacts",
};

/**
 * The dork question is graded on the set of URLs a query returns, not on the
 * query text, so many different queries are equally correct. Comparing strings
 * would fail a right answer; we check the result set instead.
 */
const SET_GRADED = "q-google-dorks-advanced";

const root = path.resolve(import.meta.dirname, "..");
const shims = pathToFileURL(path.join(root, "tools", "shims.mjs")).href;

let src = patch(fs.readFileSync(path.join(root, "vendor", "ga7.bundle.js"), "utf8"));
src = src
  .replace(/"https:\/\/cdn\.jsdelivr\.net\/npm\/seedrandom@3\.0\.5\/\+esm"/g, '"seedrandom"')
  .replace(/"https:\/\/cdn\.jsdelivr\.net\/npm\/lit-html@3\/directives\/unsafe-html\.js"/g, JSON.stringify(shims))
  .replace(/"https:\/\/cdn\.jsdelivr\.net\/npm\/lit-html@3\/lit-html\.js"/g, JSON.stringify(shims))
  .replace(/"https:\/\/cdn\.jsdelivr\.net\/npm\/marked@13\/\+esm"/g, JSON.stringify(shims));

// Kept inside the project so bare imports still resolve against node_modules.
const tmp = path.join(root, `.engine-${Date.now()}.mjs`);
fs.writeFileSync(tmp, src);

const started = Date.now();
const engine = await import(pathToFileURL(tmp).href);
engine.__initAll();
const results = await solveOffline(engine, EMAIL);
const elapsed = Date.now() - started;
fs.unlinkSync(tmp);

let failed = 0;
console.log(`\n  engine verification — ${EMAIL}\n`);
for (const [id, expected] of Object.entries(EXPECTED)) {
  const got = results[id]?.answer;
  const pass = got === expected;
  if (!pass) failed++;
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${id}`);
  console.log(`        got      ${got}`);
  if (!pass) console.log(`        expected ${expected}`);
}

const dork = results[SET_GRADED];
const ev = dork.evidence;
const exact =
  ev.matched.length === ev.targets.length &&
  [...ev.matched].sort().every((u, i) => u === [...ev.targets].sort()[i]);
if (!exact || !dork.ok) failed++;
console.log(`  ${exact && dork.ok ? "PASS" : "FAIL"}  ${SET_GRADED}`);
console.log(`        got      ${dork.answer}`);
console.log(
  `\n  dork search: ${ev.matched.length}/${ev.targets.length} targets, ` +
    `${ev.tokens.length} tokens, from ${ev.documents} documents`
);
console.log(`  solved in ${elapsed} ms\n`);

process.exit(failed ? 1 : 0);
