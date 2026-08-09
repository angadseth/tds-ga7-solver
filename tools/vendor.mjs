/**
 * Refresh the vendored generator. The standalone page cannot fetch it at
 * runtime (the exam origin sends no CORS header), so a copy lives here and
 * this script keeps it current.
 *
 *   node tools/vendor.mjs [quiz]
 */
import fs from "node:fs";
import path from "node:path";

const quiz = process.argv[2] || "2026-05-ga7";
const url = `https://exam.sanand.workers.dev/exam-tds-${quiz}.js`;
const out = path.resolve(import.meta.dirname, "..", "vendor", "ga7.bundle.js");

const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
const text = await res.text();

const before = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
fs.writeFileSync(out, text);
console.log(`${before === text ? "unchanged" : "UPDATED"}  ${out}  (${text.length} bytes)`);
