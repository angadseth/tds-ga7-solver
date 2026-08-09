/**
 * Runs on the exam page itself.
 *
 * Same-origin, so it can read your signed-in email, load the quiz's own
 * generator, derive the offline answers and type them into the right fields.
 * Nothing leaves the tab.
 */
import { loadEngine, solveOffline } from "../assets/engine.js";

const PANEL_ID = "ga7-solver-panel";

const DERIVED = {
  "q-google-dorks-advanced": "Q7 · Search operators",
  "q-cloudflare-waf-bypass": "Q8 · WAF rule order",
  "q-media-forensics": "Q9 · Media forensics",
  "q-actions-workflow-audit": "Q10 · Workflow audit",
};

main();

async function main() {
  const panel = mountPanel();
  const say = (msg, kind = "") => {
    panel.status.textContent = msg;
    panel.status.dataset.kind = kind;
  };

  const user = readUser();
  if (!user?.email) {
    say("Sign in on this page first, then run the solver again.", "bad");
    return;
  }

  const quiz = readQuiz();
  if (!quiz) {
    say("Open a quiz page (the URL should end in something like tds-2026-05-ga7).", "bad");
    return;
  }

  say(`Loading the ${quiz} generator…`);
  let results;
  try {
    const engine = await loadEngine(quiz, { origin: location.origin });
    say("Deriving your variant…");
    results = await solveOffline(engine, user.email);
  } catch (error) {
    say(`Could not derive answers: ${error.message}`, "bad");
    return;
  }

  let filled = 0;
  const missing = [];
  for (const [id, label] of Object.entries(DERIVED)) {
    const result = results[id];
    const row = document.createElement("div");
    row.className = "ga7s-row";

    if (!result?.ok) {
      row.innerHTML = `<span class="ga7s-label">${label}</span><span class="ga7s-bad">not derived</span>`;
      panel.list.append(row);
      continue;
    }
    const field = document.querySelector(`[name="${CSS.escape(id)}"]`);
    if (field) {
      field.value = result.answer;
      // The page persists answers on input, so this is what makes them stick.
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      filled++;
    } else {
      missing.push(label);
    }
    row.innerHTML =
      `<span class="ga7s-label">${label}</span>` +
      `<code class="ga7s-answer">${escapeHtml(result.answer)}</code>` +
      `<span class="ga7s-${field ? "ok" : "warn"}">${field ? "filled" : "no field"}</span>`;
    panel.list.append(row);
  }

  const parts = [`${filled} of 4 fields filled`];
  if (missing.length) parts.push(`${missing.length} field(s) not on this page`);
  say(parts.join(" · "), filled === 4 ? "good" : "warn");

  showStreetViewImage(panel);

  const foot = document.createElement("p");
  foot.className = "ga7s-foot";
  foot.textContent =
    "The five policy gates are graded against your own live service, so they cannot be filled " +
    "from here. Press Save yourself once you have checked these.";
  panel.body.append(foot);
}

/**
 * Street View cannot be derived, but the image is right here on the page — so
 * hand over its URL rather than making anyone hunt through devtools for it.
 */
function showStreetViewImage(panel) {
  const scope = document.querySelector('[data-question="q-streetview-geolocation-server"]');
  const src = scope?.querySelector("img")?.src;
  if (!src) return;

  const row = document.createElement("div");
  row.className = "ga7s-row";
  row.innerHTML =
    `<span class="ga7s-label">Q6 · Street View image</span>` +
    `<span class="ga7s-warn">not derivable</span>` +
    `<code class="ga7s-answer">${escapeHtml(src)}</code>`;

  const copy = document.createElement("button");
  copy.className = "ga7s-copy";
  copy.textContent = "Copy image URL";
  copy.addEventListener("click", async () => {
    await navigator.clipboard.writeText(src);
    copy.textContent = "Copied";
    setTimeout(() => (copy.textContent = "Copy image URL"), 1200);
  });
  row.append(copy);
  panel.list.append(row);
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
    #${PANEL_ID}{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:min(30rem,calc(100vw - 32px));
      background:#141b1a;color:#e4eae7;border:1px solid #35443f;border-radius:4px;
      font:12.5px/1.55 ui-monospace,Consolas,monospace;box-shadow:0 10px 40px rgba(0,0,0,.45)}
    #${PANEL_ID} .ga7s-head{display:flex;align-items:baseline;gap:.6rem;padding:.6rem .8rem;border-bottom:1px solid #253130}
    #${PANEL_ID} .ga7s-name{font-weight:700;letter-spacing:-.01em}
    #${PANEL_ID} .ga7s-x{margin-left:auto;cursor:pointer;background:none;border:0;color:#7a8884;font:inherit;font-size:15px;line-height:1}
    #${PANEL_ID} .ga7s-x:hover{color:#e4eae7}
    #${PANEL_ID} .ga7s-body{padding:.7rem .8rem;max-height:60vh;overflow:auto}
    #${PANEL_ID} .ga7s-status{margin:0 0 .6rem;color:#a3b1ad}
    #${PANEL_ID} .ga7s-status[data-kind=good]{color:#6fc9ad}
    #${PANEL_ID} .ga7s-status[data-kind=warn]{color:#d6a54e}
    #${PANEL_ID} .ga7s-status[data-kind=bad]{color:#e08a78}
    #${PANEL_ID} .ga7s-row{display:grid;grid-template-columns:1fr auto;gap:.15rem .6rem;padding:.45rem 0;border-top:1px solid #253130}
    #${PANEL_ID} .ga7s-label{color:#a3b1ad}
    #${PANEL_ID} .ga7s-answer{grid-column:1/-1;color:#6fc9ad;word-break:break-all;background:none;border:0;padding:0;font:inherit}
    #${PANEL_ID} .ga7s-ok{color:#6fc9ad}
    #${PANEL_ID} .ga7s-warn{color:#d6a54e}
    #${PANEL_ID} .ga7s-bad{color:#e08a78}
    #${PANEL_ID} .ga7s-foot{margin:.8rem 0 0;color:#7a8884}
    #${PANEL_ID} .ga7s-copy{grid-column:1/-1;justify-self:start;margin-top:.3rem;cursor:pointer;
      font:inherit;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:#a3b1ad;
      background:none;border:1px solid #35443f;border-radius:2px;padding:.15rem .5rem}
    #${PANEL_ID} .ga7s-copy:hover{color:#e4eae7;border-color:#7a8884}
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
