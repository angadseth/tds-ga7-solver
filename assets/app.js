import { loadEngine, solveOffline } from "./engine.js";

const QUIZ = "2026-05-ga7";

/** Presentation metadata. Marks and gating come from the exam, not from us. */
const CATALOGUE = [
  { id: "q-cicd-container-release-gate-server", n: 1, title: "CI/CD Container Release Gate", marks: 2, mode: "service" },
  { id: "q-llm-action-firewall-server", n: 2, title: "LLM Action Firewall", marks: 2, mode: "service" },
  { id: "q-terraform-plan-guard-server", n: 3, title: "Terraform Plan Policy Gate", marks: 2, mode: "service" },
  { id: "q-llm-output-sanitizer-server", n: 4, title: "LLM Output Handling Gate", marks: 2, mode: "service" },
  { id: "q-osint-corroboration-server", n: 5, title: "OSINT Corroboration Engine", marks: 2, mode: "service" },
  { id: "q-streetview-geolocation-server", n: 6, title: "Street View OSINT", marks: 2, mode: "lookup" },
  { id: "q-google-dorks-advanced", n: 7, title: "Advanced Search Operators", marks: 1, mode: "derived" },
  { id: "q-cloudflare-waf-bypass", n: 8, title: "WAF Rule Order", marks: 1, mode: "derived" },
  { id: "q-media-forensics", n: 9, title: "Media Forensics", marks: 1, mode: "derived" },
  { id: "q-actions-workflow-audit", n: 10, title: "Audit a GitHub Actions Workflow", marks: 1, mode: "derived" },
];

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

let enginePromise = null;
const engine = () => (enginePromise ??= boot());

async function boot() {
  const res = await fetch("./vendor/ga7.bundle.js");
  if (!res.ok) throw new Error(`Could not load the question generator (HTTP ${res.status}).`);
  return loadEngine(QUIZ, { source: await res.text() });
}

/* ---------------------------------------------------------------- */

const form = $("#run");
const emailInput = $("#email");
const status = $("#status");
const ledger = $("#ledger");
const summary = $("#summary");

emailInput.value = localStorage.getItem("ga7-solver-email") || "";

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = emailInput.value.trim();
  if (!email) return;
  localStorage.setItem("ga7-solver-email", email);
  await run(email);
});

async function run(email) {
  setStatus("working", "Loading the exam's own generator…");
  ledger.replaceChildren();
  summary.replaceChildren();

  let results;
  const started = performance.now();
  try {
    const mod = await engine();
    setStatus("working", "Deriving your variant…");
    results = await solveOffline(mod, email);
  } catch (error) {
    setStatus("error", error.message);
    return;
  }
  const ms = Math.round(performance.now() - started);

  const derived = CATALOGUE.filter((q) => q.mode === "derived");
  const solved = derived.filter((q) => results[q.id]?.ok).length;
  const marks = derived.filter((q) => results[q.id]?.ok).reduce((a, q) => a + q.marks, 0);

  setStatus("ok", `${solved} of ${derived.length} derived in ${ms} ms`);
  renderSummary(marks, ms);
  for (const q of CATALOGUE) ledger.append(renderRow(q, results[q.id], email));
}

function setStatus(kind, text) {
  status.dataset.kind = kind;
  status.textContent = text;
}

function renderSummary(marks, ms) {
  const facts = [
    [String(marks), "marks derived offline"],
    ["12", "marks needing your own service"],
    [`${ms} ms`, "to solve, in this tab"],
    ["0", "requests to the exam server"],
  ];
  for (const [value, label] of facts) {
    const card = el("div", "fact");
    card.append(el("div", "fact-value", value), el("div", "fact-label", label));
    summary.append(card);
  }
}

/* ---------------------------------------------------------------- */

function renderRow(q, result, email) {
  const row = el("details", `row row--${q.mode}`);
  const head = el("summary", "row-head");

  head.append(el("span", "row-n", String(q.n).padStart(2, "0")));
  head.append(el("span", "row-title", q.title));
  head.append(el("span", "row-marks", `${q.marks} ${q.marks === 1 ? "mark" : "marks"}`));

  const answerCell = el("span", "row-answer");
  if (q.mode === "derived" && result?.ok) {
    answerCell.classList.add("is-answer");
    answerCell.textContent = result.answer;
  } else if (q.mode === "service") {
    answerCell.classList.add("is-pending");
    answerCell.textContent = "your deployed URL";
  } else if (q.mode === "lookup") {
    answerCell.classList.add("is-pending");
    answerCell.textContent = "image lookup";
  } else {
    answerCell.classList.add("is-fail");
    answerCell.textContent = "not derived";
  }
  head.append(answerCell);

  if (q.mode === "derived" && result?.ok) {
    const copy = el("button", "copy", "Copy");
    copy.type = "button";
    copy.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await navigator.clipboard.writeText(result.answer);
      copy.textContent = "Copied";
      setTimeout(() => (copy.textContent = "Copy"), 1200);
    });
    head.append(copy);
  }

  row.append(head);
  row.append(renderEvidence(q, result, email));
  return row;
}

function renderEvidence(q, result, email) {
  const body = el("div", "row-body");
  if (q.mode === "service") {
    body.append(
      note(
        "The grader calls your endpoint directly with hidden payloads, so there is no answer to derive — " +
          "only a service that behaves correctly. Deploy the reference implementation and paste its base URL."
      )
    );
    return body;
  }
  if (q.mode === "lookup") {
    body.append(
      note(
        "The image is chosen server-side, so the location cannot be computed from your email. " +
          "Identify the landmark, then answer with the city — not the landmark's own name."
      )
    );
    return body;
  }
  if (!result) return body;

  const ev = result.evidence;
  switch (q.id) {
    case "q-google-dorks-advanced": {
      body.append(note(ev.note));
      body.append(kv("Tokens used", ev.tokens.join("  ")));
      body.append(list("Documents returned", ev.matched));
      break;
    }
    case "q-cloudflare-waf-bypass": {
      body.append(
        note(
          `${ev.rules} rules evaluated against ${ev.requests} requests. ` +
            `Rules ${ev.swapped[0]} and ${ev.swapped[1]} are the pair that swap; rule ${ev.overBlockRule} is the over-blocking one.`
        )
      );
      body.append(kv("Reaching the origin", String(ev.reachingOrigin)));
      body.append(kv("Flips after the swap", ev.flipped.join(", ")));
      body.append(kv("After exempting verified bots", String(ev.afterExemption)));
      body.append(table(
        ["Request", "Outcome", "Decided by"],
        ev.perRequest.map((r) => [r.id, r.verdict.action, r.verdict.ruleNumber ?? "fell through"])
      ));
      break;
    }
    case "q-media-forensics": {
      body.append(note(ev.note));
      body.append(kv("Hidden token", ev.imageToken));
      body.append(kv("Tone digits", ev.audioDigits));
      body.append(kv("Frames", `${ev.frameCount}, in ${ev.scenes.length} scenes`));
      body.append(table(
        ["Scene", "Colour index", "Frames"],
        ev.scenes.map((s, i) => [String(i + 1), String(s.colourIndex), String(s.length)])
      ));
      break;
    }
    case "q-actions-workflow-audit": {
      body.append(kv("Findings present", ev.findings.join(", ")));
      body.append(kv("Abusable job", ev.previewJob));
      body.append(kv("Deploy job", ev.deployJob));
      break;
    }
  }
  return body;
}

const note = (text) => el("p", "note", text);

function kv(label, value) {
  const wrap = el("div", "kv");
  wrap.append(el("dt", null, label), el("dd", null, value));
  return wrap;
}

function list(label, items) {
  const wrap = el("div", "kv");
  const dd = el("dd");
  const ul = el("ul", "urls");
  for (const item of items) ul.append(el("li", null, item));
  dd.append(ul);
  wrap.append(el("dt", null, label), dd);
  return wrap;
}

function table(headers, rows) {
  const scroll = el("div", "scroll");
  const t = el("table");
  const thead = el("thead");
  const tr = el("tr");
  headers.forEach((h) => tr.append(el("th", null, h)));
  thead.append(tr);
  const tbody = el("tbody");
  for (const row of rows) {
    const r = el("tr");
    row.forEach((c) => r.append(el("td", null, String(c))));
    tbody.append(r);
  }
  t.append(thead, tbody);
  scroll.append(t);
  return scroll;
}

if (emailInput.value) form.requestSubmit();
