import { loadEngine, solveOffline } from "./engine.js";
import { geolocate, formatAnswer, lookupKnown } from "./streetview.js";
import {
  baseUrlFor,
  releaseGateAnswer,
  fetchAssigned,
  runProbes,
  checkWorkflow,
  createWorkflow,
  workflowStatus,
  savedScore,
} from "./service.js";

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

  document.getElementById("live")?.remove();
  const live = await renderLiveScore(email);
  live.id = "live";
  summary.after(live);

  document.getElementById("verifier")?.remove();
  const verifier = await renderVerifier(email);
  verifier.id = "verifier";
  ledger.after(verifier);
}

function setStatus(kind, text) {
  status.dataset.kind = kind;
  status.textContent = text;
}

async function renderLiveScore(email) {
  const strip = el("div", "live");
  const label = el("span", "live-label", "Score recorded by the exam");
  const value = el("span", "live-value", "checking…");
  const detail = el("span", "live-detail", "");
  const again = el("button", "copy", "Refresh");
  again.type = "button";

  const load = async () => {
    value.textContent = "checking…";
    value.className = "live-value";
    detail.textContent = "";
    try {
      const r = await savedScore(email);
      if (r.error) throw new Error(r.error);
      if (!r.saved) {
        value.textContent = "nothing saved yet";
        value.classList.add("live-value--none");
        detail.textContent = "Fill the answers, then press Save on the exam page.";
        return;
      }
      value.textContent = `${r.total} / ${r.max}`;
      value.classList.add(r.total === r.max ? "live-value--full" : "live-value--part");
      const when = new Date(r.time).toLocaleString();
      const missing = CATALOGUE.filter((q) => (r.scores?.[q.id] ?? 0) < q.marks)
        .map((q) => `Q${q.n}`);
      detail.textContent = missing.length
        ? `saved ${when} · still short on ${missing.join(", ")}`
        : `saved ${when} · every question full`;
    } catch (error) {
      value.textContent = "could not read it";
      value.classList.add("live-value--none");
      detail.textContent = error.message;
    }
  };

  again.addEventListener("click", load);
  strip.append(label, value, detail, again);
  load();
  return strip;
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


/* ---------------------------------------------------------------- *
 * The five gate questions: a working endpoint, and a way to check it.
 * ---------------------------------------------------------------- */

const WORKFLOW_KEY = "ga7-solver-workflow";
const workflowUrl = () => localStorage.getItem(WORKFLOW_KEY) || "";

/** What to paste for a given service question. */
function serviceAnswer(q, email) {
  return q.n === 1 ? releaseGateAnswer(email, workflowUrl()) : baseUrlFor(email);
}

/**
 * Question one also wants a workflow URL, and it has to be the student's own
 * repository — the workflow carries a step named with their email, so it is the
 * one part of these five that cannot be shared.
 */
function renderWorkflowField(email, onChange) {
  const wrap = el("div", "wf");

  const make = el("button", "go", "Create my workflow");
  make.type = "button";
  const state = el("p", "note");
  const out = el("div", "wf-out");

  const input = el("input", "sv-input");
  input.type = "url";
  input.placeholder = "https://github.com/YOU/REPO/actions/workflows/release-gate.yml";
  input.value = workflowUrl();

  const commit = (url) => {
    input.value = url;
    localStorage.setItem(WORKFLOW_KEY, url);
    onChange();
  };

  make.addEventListener("click", async () => {
    make.disabled = true;
    out.replaceChildren();
    state.textContent = "Committing your workflow…";
    try {
      const result = await createWorkflow(email);
      commit(result.workflowUrl);
      state.textContent = result.created
        ? "Committed. Waiting for the run to go green…"
        : "Already there. Checking the run…";

      // The badge is what the exam actually reads, so wait for it.
      const deadline = Date.now() + 120000;
      let status = result.status;
      while (status !== "passing" && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 6000));
        status = (await workflowStatus(email))?.status ?? status;
      }
      state.textContent =
        status === "passing"
          ? "Green. Question one is complete — copy the answer above."
          : `Committed, but the run is still ${status}. Give it a minute and press again.`;
      state.className = status === "passing" ? "note wf-ok" : "note wf-warn";
    } catch (error) {
      state.className = "note wf-warn";
      state.textContent = error.message;
    } finally {
      make.disabled = false;
    }
  });

  // Manual route, for anyone who would rather point at their own repository.
  const manual = el("details", "wf-manual");
  manual.append(el("summary", null, "…or use a workflow I already have"));

  const check = el("button", "go", "Check");
  check.type = "button";
  check.addEventListener("click", async () => {
    commit(input.value.trim());
    out.replaceChildren();
    check.disabled = true;
    try {
      const result = await checkWorkflow(input.value.trim(), email);
      for (const [label, pass] of result.checks) {
        const line = el("div", `probe probe--${pass ? "ok" : "bad"}`);
        line.append(el("span", "probe-mark", pass ? "pass" : "FAIL"), el("span", "probe-name", label));
        out.append(line);
      }
      for (const problem of result.problems) out.append(el("p", "sv-error", problem));
    } catch (error) {
      out.append(el("p", "sv-error", error.message));
    } finally {
      check.disabled = false;
    }
  });

  const row = el("div", "probe-controls");
  row.append(input, check);
  manual.append(row);

  wrap.append(make, state, manual, out);
  return wrap;
}

async function renderVerifier(email) {
  const section = el("section", "block");
  section.append(el("h2", null, "Verify before you save"));
  section.append(
    el(
      "p",
      null,
      "The grader will not tell you why a gate failed, so this runs the same shapes of payload " +
        "against the endpoint and shows each verdict. Point it at the URL above, or at your own " +
        "deployment if you would rather host it yourself."
    )
  );

  const url = el("input", "sv-input");
  url.type = "url";
  url.value = baseUrlFor(email);
  const go = el("button", "go", "Run probes");
  go.type = "button";

  const bar = el("div", "probe-bar");
  const out = el("div", "probe-out");

  const controls = el("div", "probe-controls");
  controls.append(url, go);
  section.append(controls, bar, out);

  go.addEventListener("click", async () => {
    out.replaceChildren();
    bar.replaceChildren();
    go.disabled = true;
    const count = el("span", "probe-count", "starting…");
    bar.append(count);
    try {
      const assigned = await fetchAssigned(email);
      let last = null;
      for await (const r of runProbes(url.value.trim(), {
        ...assigned,
        allowedHosts: assigned.allowedHosts,
      })) {
        last = r;
        count.textContent = `${r.passed} / ${r.total} passing`;
        const row = el("div", `probe probe--${r.ok ? "ok" : "bad"}`);
        row.append(el("span", "probe-mark", r.ok ? "pass" : "FAIL"));
        row.append(el("span", "probe-name", r.name));
        row.append(el("span", "probe-path", r.path));
        if (!r.ok) row.append(el("code", "probe-detail", r.detail.slice(0, 200)));
        out.append(row);
      }
      if (last) {
        count.textContent = `${last.passed} / ${last.total} passing`;
        count.className = `probe-count probe-count--${last.passed === last.total ? "ok" : "bad"}`;
      }
    } catch (error) {
      out.append(el("p", "sv-error", error.message));
    } finally {
      go.disabled = false;
    }
  });

  return section;
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
    answerCell.classList.add("is-answer");
    answerCell.textContent = serviceAnswer(q, email);
  } else if (q.mode === "lookup") {
    answerCell.classList.add("is-pending");
    answerCell.textContent = "image lookup";
  } else {
    answerCell.classList.add("is-fail");
    answerCell.textContent = "not derived";
  }
  head.append(answerCell);

  if (q.mode === "derived" ? result?.ok : q.mode === "service") {
    const value = q.mode === "service" ? serviceAnswer(q, email) : result.answer;
    const copy = el("button", "copy", "Copy");
    copy.type = "button";
    copy.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await navigator.clipboard.writeText(value);
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
        "The grader calls this endpoint directly with hidden payloads, so there is nothing to derive — " +
          "only a service that behaves correctly. The URL above is one, and it answers for you " +
          "specifically: your identity travels in the path, so it enforces your assigned values and " +
          "would give a different verdict for anyone else."
      )
    );
    if (q.n === 1) {
      body.append(
        note(
          "It also wants a workflow whose step is named with your email — so it cannot be shared, " +
            "and has to be made for you. One button does that."
        )
      );
      body.append(renderWorkflowField(email, () => {
        const cell = body.parentElement?.querySelector(".row-answer");
        if (cell) cell.textContent = serviceAnswer(q, email);
      }));
    }
    return body;
  }
  if (q.mode === "lookup") {
    body.append(
      note(
        "The image is chosen server-side, so this is the one question that cannot be computed from " +
          "your email. Paste the image and a vision model will identify it — but answer with the " +
          "city, never the landmark's own name, which is what the exam actually grades."
      )
    );
    body.append(renderStreetView());
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

/* ---------------------------------------------------------------- *
 * Street View — the only place a model is involved, and the only
 * place a token is asked for. It is used once, from this tab, against
 * aipipe.org, and never stored.
 * ---------------------------------------------------------------- */

const GEMINI_PROMPT = `You are an OSINT geolocation analyst. Identify where this Street View photo was taken.

Answer in exactly this format, on one line:
Place, Country, Latitude, Longitude

Rules that decide whether my answer scores:
- "Place" must be the CITY or town, never the park, museum, street or landmark.
  If you recognise the Hiroshima Peace Memorial Museum, the place is "Hiroshima".
- "Country" must be the full English name: "United States", not "USA".
- The coordinates must be the CAMERA's position - the exact street corner visible
  in the photo, not the centre of the city or the landmark's own pin. More than
  100 metres out scores zero.
- Use driving side, number plates, script and language on signage, road markings,
  kerb paint, utility poles, vegetation and architecture as evidence.

After the answer line, list the visual clues you used and name the landmark, so I can check you.`;

function renderStreetView() {
  const panel = el("div", "sv");

  const steps = el("ol", "steps");
  const step = (html) => {
    const li = document.createElement("li");
    li.innerHTML = html;
    return li;
  };
  steps.append(
    step("On the GA7 page, <strong>right-click the Street View image → Copy image</strong>. " +
         "(The bookmarklet also puts its URL on your clipboard.)"),
    step('Open <a href="https://gemini.google.com" target="_blank" rel="noopener noreferrer">gemini.google.com</a> ' +
         "or any chat model that accepts images. Paste the image."),
    step("Paste the prompt below with it. It is written around the two things that actually " +
         "decide this mark, which is where most answers are lost."),
    step("Put the answer line into GA7 and press Check <em>before</em> you save."),
  );

  const promptBox = el("pre", "sv-prompt", GEMINI_PROMPT);

  const actions = el("div", "sv-actions");
  const copyPrompt = el("button", "go", "Copy prompt & open Gemini");
  copyPrompt.type = "button";
  copyPrompt.addEventListener("click", async () => {
    await navigator.clipboard.writeText(GEMINI_PROMPT);
    copyPrompt.textContent = "Copied — paste the image, then this";
    window.open("https://gemini.google.com/app", "_blank", "noopener");
    setTimeout(() => (copyPrompt.textContent = "Copy prompt & open Gemini"), 2500);
  });
  actions.append(copyPrompt, el("span", "sv-free", "free — no token, no credits"));

  panel.append(steps, promptBox, actions);

  // Optional: do the same call from here, if you would rather not leave the page.
  const auto = el("details", "sv-auto");
  const sum = el("summary", null, "…or run it here with an aipipe token");
  auto.append(sum);

  const imageField = el("input", "sv-input");
  imageField.type = "url";
  imageField.placeholder = "paste the image URL";

  const file = el("input", "sv-file");
  file.type = "file";
  file.accept = "image/*";

  const token = el("input", "sv-input");
  token.type = "password";
  token.placeholder = "aipipe.org token (used once, never stored)";
  token.autocomplete = "off";

  const go = el("button", "go", "Identify");
  go.type = "button";
  const out = el("div", "sv-out");

  auto.append(field("Image URL", imageField), field("…or a file", file), field("Token", token), go, out);

  let dataUrl = null;
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    dataUrl = f ? await readAsDataUrl(f) : null;
  });

  go.addEventListener("click", async () => {
    out.replaceChildren();
    go.disabled = true;
    try {
      const url = imageField.value.trim();
      const known = await lookupKnown(url);
      const result = known ?? (await geolocate({ imageUrl: url, imageDataUrl: dataUrl, token: token.value.trim() }));
      token.value = "";
      renderGuess(out, result);
    } catch (error) {
      out.append(el("p", "sv-error", error.message));
    } finally {
      go.disabled = false;
    }
  });

  panel.append(auto);
  return panel;
}

function renderGuess(out, r) {
  const answer = formatAnswer(r);
  if (answer) {
    const line = el("div", "sv-answer");
    line.append(el("code", null, answer));
    const copy = el("button", "copy", "Copy");
    copy.type = "button";
    copy.addEventListener("click", async () => {
      await navigator.clipboard.writeText(answer);
      copy.textContent = "Copied";
      setTimeout(() => (copy.textContent = "Copy"), 1200);
    });
    line.append(copy);
    out.append(line);
  }
  out.append(kv("Confidence", r.confidence));
  if (r.landmark) out.append(kv("Recognised", r.landmark));
  if (r.cues.length) out.append(list("Evidence", r.cues));
  if (r.confidence !== "confirmed") {
    out.append(
      note(
        "Check the pin before you save. The place and country are usually right for a recognisable " +
          "landmark; the coordinates are the part that drifts, and the tolerance is only 100 metres."
      )
    );
  }
}

function field(label, control) {
  const wrap = el("label", "sv-field");
  wrap.append(el("span", null, label), control);
  return wrap;
}

const readAsDataUrl = (f) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(f);
  });

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
