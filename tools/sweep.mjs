/**
 * Sweep: does every student get a different — and solvable — variant?
 *
 * Q8/Q9/Q10 come straight out of the generator, so they are correct by
 * construction. Q7 is the one that can genuinely fail: its answer is a query
 * that has to be searched for, so this measures how often that search succeeds
 * and confirms each hit against the exam's own matcher.
 *
 *   node tools/sweep.mjs [count]
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { patch, solveOffline } from "../assets/engine.js";

const COUNT = Number(process.argv[2] || 30);
const root = path.resolve(import.meta.dirname, "..");
const shims = pathToFileURL(path.join(root, "tools", "shims.mjs")).href;

let src = patch(fs.readFileSync(path.join(root, "vendor", "ga7.bundle.js"), "utf8"));
src = src
  .replace(/"https:\/\/cdn\.jsdelivr\.net\/npm\/seedrandom@3\.0\.5\/\+esm"/g, '"seedrandom"')
  .replace(/"https:\/\/cdn\.jsdelivr\.net\/npm\/lit-html@3\/directives\/unsafe-html\.js"/g, JSON.stringify(shims))
  .replace(/"https:\/\/cdn\.jsdelivr\.net\/npm\/lit-html@3\/lit-html\.js"/g, JSON.stringify(shims))
  .replace(/"https:\/\/cdn\.jsdelivr\.net\/npm\/marked@13\/\+esm"/g, JSON.stringify(shims));

const tmp = path.join(root, `.sweep-${Date.now()}.mjs`);
fs.writeFileSync(tmp, src);
const engine = await import(pathToFileURL(tmp).href);
engine.__initAll();
fs.unlinkSync(tmp);

/** Plausible IITM addresses across years, programmes and roll numbers. */
function emails(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const year = 21 + (i % 6);
    const stream = ["f1", "f2", "f3"][i % 3];
    const roll = String(100000 + i * 7919).slice(0, 6);
    out.push(`${year}${stream}${roll}@ds.study.iitm.ac.in`);
  }
  return out;
}

const seen = { dork: new Set(), waf: new Set(), media: new Set(), wf: new Set() };
let dorkFail = 0;
let slowest = 0;
const rows = [];

for (const email of emails(COUNT)) {
  const t0 = performance.now();
  const r = await solveOffline(engine, email);
  const ms = performance.now() - t0;
  slowest = Math.max(slowest, ms);

  const dork = r["q-google-dorks-advanced"];
  const waf = r["q-cloudflare-waf-bypass"].answer;
  const media = r["q-media-forensics"].answer;
  const wf = r["q-actions-workflow-audit"].answer;

  // Independently re-confirm the query with the exam's matcher.
  let confirmed = false;
  if (dork.ok) {
    const idx = engine.generateDorkIndex(email, "v1");
    const got = engine.runQuery(dork.answer, idx.docs).sort();
    const want = [...idx.targets].sort();
    confirmed =
      got.length === want.length &&
      got.every((u, i) => u === want[i]) &&
      engine.tokenizeQuery(dork.answer).length <= 6;
  }
  if (!confirmed) dorkFail++;

  seen.dork.add(dork.answer ?? "∅");
  seen.waf.add(waf);
  seen.media.add(media);
  seen.wf.add(wf);

  rows.push({ email, confirmed, tokens: dork.ok ? dork.evidence.tokens.length : 0, waf, media, wf, ms });
}

console.log(`\n  sweep over ${COUNT} distinct emails\n`);
for (const r of rows.slice(0, 8)) {
  console.log(
    `  ${r.email.padEnd(30)} Q7 ${r.confirmed ? "ok" : "FAIL"} (${r.tokens}t)  ` +
      `Q8 ${r.waf.padEnd(14)} Q9 ${r.media.padEnd(24)} Q10 ${r.wf}`
  );
}
if (rows.length > 8) console.log(`  … ${rows.length - 8} more`);

console.log(`\n  distinct answers produced`);
console.log(`    Q7 queries          ${seen.dork.size} / ${COUNT}`);
console.log(`    Q8 answers          ${seen.waf.size} / ${COUNT}`);
console.log(`    Q9 answers          ${seen.media.size} / ${COUNT}`);
console.log(`    Q10 answers         ${seen.wf.size} / ${COUNT}   (only 64 combinations exist, so repeats are expected)`);
console.log(`\n  Q7 search confirmed  ${COUNT - dorkFail} / ${COUNT}`);
console.log(`  slowest solve        ${Math.round(slowest)} ms\n`);

process.exit(dorkFail ? 1 : 0);
