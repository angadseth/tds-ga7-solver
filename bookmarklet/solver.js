/**
 * Runs on the exam page itself.
 *
 * Same-origin, so it can read your signed-in email, load the quiz's own
 * generator, fill every field it can answer, then save and read the score back.
 * Nothing leaves the tab.
 *
 * Saving is a button rather than something that happens the moment this loads:
 * it overwrites your previous submission, so it should be a decision you make
 * after looking at what got filled in.
 */
import { loadEngine, solveOffline } from "../assets/engine.js";
import {
  baseUrlFor,
  releaseGateAnswer,
  workflowYaml,
  workflowTest,
  prefilledCommitUrl,
  workflowUrlFor,
  WORKFLOW_FILENAME,
} from "../assets/service.js";

const PANEL_ID = "ga7-solver-panel";
const WORKFLOW_KEY = "ga7-solver-workflow";

const DERIVED = {
  "q-google-dorks-advanced": "Q7 · Search operators",
  "q-cloudflare-waf-bypass": "Q8 · WAF rule order",
  "q-media-forensics": "Q9 · Media forensics",
  "q-actions-workflow-audit": "Q10 · Workflow audit",
};

/** The five gates: an endpoint, not a value. Q1 also needs your own workflow. */
const SERVICE = {
  "q-cicd-container-release-gate-server": "Q1 · Release gate",
  "q-llm-action-firewall-server": "Q2 · Action firewall",
  "q-terraform-plan-guard-server": "Q3 · Terraform gate",
  "q-llm-output-sanitizer-server": "Q4 · Output gate",
  "q-osint-corroboration-server": "Q5 · Corroboration",
};

const TITLES = { ...SERVICE, "q-streetview-geolocation-server": "Q6 · Street View", ...DERIVED };

main();

async function main() {
  const panel = mountPanel();
  const say = (msg, kind = "") => {
    panel.status.textContent = msg;
    panel.status.dataset.kind = kind;
  };

  const user = readUser();
  if (!user?.email) return say("Sign in on this page first, then run the solver again.", "bad");

  const quiz = readQuiz();
  if (!quiz) return say("Open a quiz page — the URL should end in something like tds-2026-05-ga7.", "bad");

  say(`Deriving your variant from ${user.email}…`);
  let results;
  try {
    const engine = await loadEngine(quiz, { origin: location.origin });
    results = await solveOffline(engine, user.email);
  } catch (error) {
    return say(`Could not derive answers: ${error.message}`, "bad");
  }

  const filled = fill(results, user.email);
  say(`${filled} of ${Object.keys(DERIVED).length + Object.keys(SERVICE).length} fields filled`, filled ? "good" : "warn");

  panel.body.append(workflowRow(results, user.email, panel));
  streetViewRow(panel);
  panel.body.append(saveRow(quiz, user, panel));
}

/* ------------------------------------------------------------------ */

function fill(results, email) {
  let count = 0;
  const set = (id, value, label, extra) => {
    const field = document.querySelector(`[name="${CSS.escape(id)}"]`);
    if (field) {
      field.value = value;
      // The page persists on input, so this is what makes an answer stick.
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      count++;
    }
    row(label, value, field ? "ok" : "warn", field ? extra || "filled" : "no field");
  };

  for (const [id, label] of Object.entries(DERIVED)) {
    const r = results[id];
    if (r?.ok) set(id, r.answer, label);
    else row(label, "—", "bad", "not derived");
  }
  for (const [id, label] of Object.entries(SERVICE)) {
    if (id.startsWith("q-cicd")) {
      const workflow = localStorage.getItem(WORKFLOW_KEY) || "";
      if (!workflow) {
        // An empty workflowUrl makes the exam reject the whole answer as an
        // invalid URL, which is worse than leaving the field alone.
        row(label, "waiting for your workflow URL — see below", "warn", "not filled");
        continue;
      }
      set(id, releaseGateAnswer(email, workflow), label);
      continue;
    }
    set(id, baseUrlFor(email), label);
  }
  return count;
}

function row(label, value, kind, note) {
  const panel = document.getElementById(PANEL_ID);
  const el = document.createElement("div");
  el.className = "ga7s-row";
  el.innerHTML =
    `<span class="ga7s-label">${escapeHtml(label)}</span>` +
    `<span class="ga7s-${kind}">${escapeHtml(note)}</span>` +
    `<code class="ga7s-answer">${escapeHtml(String(value).slice(0, 160))}</code>`;
  panel.querySelector(".ga7s-list").append(el);
}

/**
 * Q1's other half is the student's own repository, because the workflow carries
 * a step named with their email. This walks them through creating it once.
 */
function workflowRow(results, email, panel) {
  const wrap = document.createElement("div");
  wrap.className = "ga7s-block";

  const have = localStorage.getItem(WORKFLOW_KEY) || "";
  wrap.innerHTML =
    `<div class="ga7s-label">Q1 · your workflow page URL` +
    (have ? "" : ` <span class="ga7s-warn">— required, Q1 stays empty without it</span>`) +
    `</div>`;

  const input = document.createElement("input");
  input.className = "ga7s-input";
  input.placeholder = "https://github.com/YOU/REPO/actions/workflows/release-gate.yml";
  input.value = have;

  const apply = () => {
    const url = input.value.trim();
    localStorage.setItem(WORKFLOW_KEY, url);
    const field = document.querySelector('[name="q-cicd-container-release-gate-server"]');
    if (field && url) {
      field.value = releaseGateAnswer(email, url);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      status.textContent = "Question one filled.";
      status.className = "ga7s-ok";
    }
  };
  input.addEventListener("change", apply);
  input.addEventListener("blur", apply);

  const status = document.createElement("div");
  status.className = "ga7s-warn";

  // Setup path, for anyone who has not made the repository yet.
  const setup = document.createElement("details");
  setup.className = "ga7s-setup";
  setup.innerHTML = `<summary>I do not have that repository yet</summary>`;

  const steps = document.createElement("ol");
  steps.innerHTML =
    `<li>Create a <strong>public</strong> repository: ` +
    `<a href="https://github.com/new" target="_blank" rel="noopener">github.com/new</a> — any name, tick “Add a README”.</li>` +
    `<li>Paste its URL here:</li>`;

  const repo = document.createElement("input");
  repo.className = "ga7s-input";
  repo.placeholder = "https://github.com/YOU/YOUR-REPO";

  const links = document.createElement("div");
  links.className = "ga7s-links";

  repo.addEventListener("input", () => {
    links.replaceChildren();
    const commit = prefilledCommitUrl(repo.value, WORKFLOW_FILENAME, workflowYaml(email));
    const testCommit = prefilledCommitUrl(repo.value, "release_gate_test.py", workflowTest());
    const wf = workflowUrlFor(repo.value);
    if (!commit) return;

    links.append(
      link("3. Commit the test file", testCommit),
      link("4. Commit the workflow", commit),
      note("5. Wait for the green tick on the Actions tab, then:")
    );
    const use = document.createElement("button");
    use.className = "ga7s-copy";
    use.textContent = "6. Use this workflow URL";
    use.addEventListener("click", () => {
      input.value = wf;
      apply();
      setup.open = false;
    });
    links.append(use);
  });

  setup.append(steps, repo, links);
  wrap.append(input, status, setup);
  return wrap;
}

function link(text, href) {
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = text;
  a.className = "ga7s-link";
  return a;
}

function note(text) {
  const p = document.createElement("div");
  p.className = "ga7s-label";
  p.textContent = text;
  return p;
}

/** Street View cannot be derived — hand over the image rather than the answer. */
function streetViewRow(panel) {
  const scope = document.querySelector('[data-question="q-streetview-geolocation-server"]');
  const src = scope?.querySelector("img")?.src;
  if (!src) return;

  const el = document.createElement("div");
  el.className = "ga7s-row";
  el.innerHTML =
    `<span class="ga7s-label">Q6 · Street View</span>` +
    `<span class="ga7s-warn">answer it yourself</span>` +
    `<code class="ga7s-answer">${escapeHtml(src)}</code>`;

  const copy = document.createElement("button");
  copy.className = "ga7s-copy";
  copy.textContent = "Copy image URL";
  copy.addEventListener("click", async () => {
    await navigator.clipboard.writeText(src);
    copy.textContent = "Copied";
    setTimeout(() => (copy.textContent = "Copy image URL"), 1200);
  });
  el.append(copy);
  panel.list.append(el);
}

/* ------------------------------------------------------------------ *
 * Save, then read the score back from the same endpoint the page uses.
 * ------------------------------------------------------------------ */

function saveRow(quiz, user, panel) {
  const wrap = document.createElement("div");
  wrap.className = "ga7s-block";

  const button = document.createElement("button");
  button.className = "ga7s-save";
  button.textContent = "Save and show my score";

  const out = document.createElement("div");
  out.className = "ga7s-score";

  button.addEventListener("click", async () => {
    button.disabled = true;
    out.textContent = "Saving…";
    const before = await latest(quiz, user.email);
    document.querySelector(".save-action")?.click();

    // The page saves asynchronously; wait for a newer submission to appear.
    const deadline = Date.now() + 90000;
    let current = before;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));
      out.textContent = "Saved — waiting for the server to score it…";
      current = await latest(quiz, user.email);
      if (current && (!before || current.time !== before.time)) break;
    }
    renderScore(out, current, before);
    button.disabled = false;
  });

  wrap.append(button, out);
  return wrap;
}

async function latest(quiz, email) {
  try {
    const res = await fetch(
      `./filter?quiz=${encodeURIComponent(quiz)}&email=${encodeURIComponent(email)}&history=1&limit=1&positives=1`
    );
    const { data } = await res.json();
    return data?.[0] ?? null;
  } catch {
    return null;
  }
}

function renderScore(out, current, before) {
  if (!current) {
    out.innerHTML = `<span class="ga7s-warn">Saved, but the score has not come back yet. Reopen the solver in a minute.</span>`;
    return;
  }
  const stale = before && current.time === before.time;
  const scores = current.scores || {};
  const lines = Object.entries(TITLES)
    .map(([id, label]) => {
      const value = scores[id];
      const got = typeof value === "number" ? value : null;
      const kind = got === null ? "warn" : got > 0 ? "ok" : "bad";
      return (
        `<div class="ga7s-row"><span class="ga7s-label">${escapeHtml(label)}</span>` +
        `<span class="ga7s-${kind}">${got === null ? "not scored" : got}</span></div>`
      );
    })
    .join("");

  out.innerHTML =
    `<div class="ga7s-total">${current.total ?? "?"} / ${current.max ?? "?"}` +
    (stale ? ` <span class="ga7s-warn">(previous save — the new one may still be scoring)</span>` : "") +
    `</div>${lines}`;
}

/* ------------------------------------------------------------------ */

function readUser() {
  try {
    return JSON.parse(localStorage.getItem("user") || "null");
  } catch {
    return null;
  }
}

/** `/tds-2026-05-ga7` → `2026-05-ga7`, which is what the bundle path expects. */
function readQuiz() {
  const slug = location.pathname.split("/").filter(Boolean).pop() || "";
  const match = slug.match(/^tds-(.+)$/);
  return match ? match[1] : null;
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function mountPanel() {
  document.getElementById(PANEL_ID)?.remove();

  const style = document.createElement("style");
  style.textContent = `
    #${PANEL_ID}{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:min(32rem,calc(100vw - 32px));
      background:#141b1a;color:#e4eae7;border:1px solid #35443f;border-radius:4px;
      font:12.5px/1.55 ui-monospace,Consolas,monospace;box-shadow:0 10px 40px rgba(0,0,0,.45)}
    #${PANEL_ID} .ga7s-head{display:flex;align-items:baseline;gap:.6rem;padding:.6rem .8rem;border-bottom:1px solid #253130}
    #${PANEL_ID} .ga7s-name{font-weight:700;letter-spacing:-.01em}
    #${PANEL_ID} .ga7s-x{margin-left:auto;cursor:pointer;background:none;border:0;color:#7a8884;font:inherit;font-size:15px;line-height:1}
    #${PANEL_ID} .ga7s-x:hover{color:#e4eae7}
    #${PANEL_ID} .ga7s-body{padding:.7rem .8rem;max-height:64vh;overflow:auto}
    #${PANEL_ID} .ga7s-status{margin:0 0 .6rem;color:#a3b1ad}
    #${PANEL_ID} .ga7s-status[data-kind=good]{color:#6fc9ad}
    #${PANEL_ID} .ga7s-status[data-kind=warn]{color:#d6a54e}
    #${PANEL_ID} .ga7s-status[data-kind=bad]{color:#e08a78}
    #${PANEL_ID} .ga7s-row{display:grid;grid-template-columns:1fr auto;gap:.15rem .6rem;padding:.4rem 0;border-top:1px solid #253130}
    #${PANEL_ID} .ga7s-label{color:#a3b1ad}
    #${PANEL_ID} .ga7s-answer{grid-column:1/-1;color:#6fc9ad;word-break:break-all;background:none;border:0;padding:0;font:inherit}
    #${PANEL_ID} .ga7s-ok{color:#6fc9ad}
    #${PANEL_ID} .ga7s-warn{color:#d6a54e}
    #${PANEL_ID} .ga7s-bad{color:#e08a78}
    #${PANEL_ID} .ga7s-block{margin-top:.9rem;padding-top:.7rem;border-top:1px solid #253130}
    #${PANEL_ID} .ga7s-input{width:100%;margin-top:.35rem;padding:.35rem .5rem;font:inherit;color:#e4eae7;
      background:#0d1211;border:1px solid #35443f;border-radius:2px;box-sizing:border-box}
    #${PANEL_ID} .ga7s-copy{grid-column:1/-1;justify-self:start;margin-top:.3rem;cursor:pointer;
      font:inherit;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:#a3b1ad;
      background:none;border:1px solid #35443f;border-radius:2px;padding:.15rem .5rem}
    #${PANEL_ID} .ga7s-copy:hover{color:#e4eae7;border-color:#7a8884}
    #${PANEL_ID} .ga7s-save{width:100%;cursor:pointer;font:inherit;font-weight:700;letter-spacing:.02em;
      color:#0d1211;background:#6fc9ad;border:0;border-radius:2px;padding:.5rem}
    #${PANEL_ID} .ga7s-save:disabled{opacity:.55;cursor:progress}
    #${PANEL_ID} .ga7s-score{margin-top:.6rem}
    #${PANEL_ID} .ga7s-total{font-size:1.3rem;font-weight:700;color:#6fc9ad;margin-bottom:.3rem}
    #${PANEL_ID} .ga7s-setup{margin-top:.6rem}
    #${PANEL_ID} .ga7s-setup summary{cursor:pointer;color:#7a8884}
    #${PANEL_ID} .ga7s-setup summary:hover{color:#e4eae7}
    #${PANEL_ID} .ga7s-setup ol{margin:.5rem 0;padding-left:1.2rem;color:#a3b1ad}
    #${PANEL_ID} .ga7s-setup li{margin:.25rem 0}
    #${PANEL_ID} .ga7s-links{display:flex;flex-direction:column;align-items:flex-start;gap:.35rem;margin-top:.5rem}
    #${PANEL_ID} .ga7s-link{color:#6fc9ad}
    #${PANEL_ID} a{color:#6fc9ad}
  `;

  const root = document.createElement("div");
  root.id = PANEL_ID;
  root.innerHTML = `
    <div class="ga7s-head">
      <span class="ga7s-name">GA7 Solver</span>
      <span style="color:#7a8884">derived locally</span>
      <button class="ga7s-x" title="Close">&times;</button>
    </div>
    <div class="ga7s-body"><p class="ga7s-status"></p><div class="ga7s-list"></div></div>
  `;
  root.querySelector(".ga7s-x").addEventListener("click", () => {
    root.remove();
    style.remove();
  });

  document.head.append(style);
  document.body.append(root);
  return {
    root,
    body: root.querySelector(".ga7s-body"),
    list: root.querySelector(".ga7s-list"),
    status: root.querySelector(".ga7s-status"),
  };
}
