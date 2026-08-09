/**
 * Engine — loads the course's own question generator and drives it.
 *
 * Nothing here re-implements a question. The exam ships its entire generator to
 * the browser; we fetch that module, rebind its lazily-aliased RNG so the
 * generators can be called directly, and read the answers out of the same code
 * the grader was built from. That is why the offline answers are exact rather
 * than inferred.
 */

const SEEDRANDOM = "https://cdn.jsdelivr.net/npm/seedrandom@3.0.5/+esm";

/** Generators we lift out of the bundle, plus the lazy-init thunks they need. */
const EXPORTS =
  "export{Ge as generateDorkIndex,We as runQuery,Pe as tokenizeQuery," +
  "Ke as generateWafScenario,te as countReachingOrigin,Je as swapRules," +
  "Qe as exemptVerifiedBots,Ve as verdictFor," +
  "nt as generateMediaScenario,lt as generateWorkflowScenario,re as FINDING_CODES};";

/**
 * The bundle keeps each question in a lazily initialised module. Until that
 * initialiser runs, module-scope helpers are undefined, so we export a hook
 * that runs every one of them before any generator is called.
 */
function patch(source) {
  const rebound = source.replace(/\(0,[A-Za-z_$][\w$]*\.default\)\(`q-/g, "__SR(`q-");
  const thunks = [...rebound.matchAll(/([A-Za-z_$][\w$]*)=U\(\(\)=>\{/g)].map((m) => m[1]);
  return (
    `import __SR from ${JSON.stringify(SEEDRANDOM)};\n` +
    rebound +
    "\n" +
    EXPORTS +
    `\nexport const __initAll=()=>{[${thunks.join(",")}].forEach(f=>{try{f()}catch(e){}})};\n`
  );
}

/** Where the exam serves a quiz's generator. Same-origin when run on the exam page. */
export function bundleUrl(quiz, origin = "https://exam.sanand.workers.dev") {
  return `${origin}/exam-tds-${quiz}.js`;
}

export async function loadEngine(quiz, { origin, source } = {}) {
  const text = source ?? (await (await fetch(bundleUrl(quiz, origin))).text());
  const url = URL.createObjectURL(new Blob([patch(text)], { type: "text/javascript" }));
  try {
    const mod = await import(/* @vite-ignore */ url);
    mod.__initAll();
    return mod;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export { patch };

/* ------------------------------------------------------------------ *
 * Q7 — smallest query that returns exactly the target set.
 *
 * Every token is ANDed, so a usable token must match *at least* all the
 * targets. Filtering the pool by that alone removes almost everything; what
 * remains is a set-cover problem over the documents that still need excluding,
 * which is small enough to solve exactly within the token budget.
 * ------------------------------------------------------------------ */

const TOKEN_LIMIT = 6;

function hostSuffixes(host) {
  const parts = host.split(".");
  const out = [];
  for (let i = 0; i < parts.length - 1; i++) out.push(parts.slice(i).join("."));
  return out;
}

function phrases(text, maxWords = 3) {
  const words = String(text).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const out = new Set();
  for (let n = 1; n <= maxWords; n++)
    for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(" "));
  return out;
}

function candidateTokens(docs, targets) {
  const targetDocs = docs.filter((d) => targets.includes(d.url));
  const tokens = new Set();
  const add = (t) => tokens.add(t);

  for (const d of targetDocs) {
    hostSuffixes(d.host).forEach((h) => add(`site:${h}`));
    add(`filetype:${d.filetype}`);
    for (const seg of d.url.split("/").filter(Boolean)) {
      if (!seg.includes(":")) add(`inurl:/${seg}/`);
    }
    phrases(d.title).forEach((p) => add(p.includes(" ") ? `intitle:"${p}"` : `intitle:${p}`));
    phrases(d.body, 4).forEach((p) => add(p.includes(" ") ? `intext:"${p}"` : `intext:${p}`));
    phrases(d.title).forEach((p) => add(p.includes(" ") ? `"${p}"` : p));
  }
  // Path segments that only ever appear on non-targets are worth negating.
  for (const d of docs) {
    for (const seg of d.url.split("/").filter(Boolean)) {
      if (!seg.includes(":") && !seg.includes(".")) add(`-inurl:/${seg}/`);
    }
    add(`-filetype:${d.filetype}`);
  }
  const years = [...new Set(docs.map((d) => d.year))].sort();
  for (let y = years[0] - 1; y <= years[years.length - 1] + 1; y++) {
    add(`after:${y}`);
    add(`before:${y}`);
  }
  return [...tokens];
}

/**
 * @returns {{query:string, tokens:string[], matched:string[], extras:string[], missing:string[]}|null}
 */
export function solveDorks(engine, docs, targets) {
  const want = [...targets].sort();
  const wantSet = new Set(want);
  const nonTargets = docs.filter((d) => !wantSet.has(d.url)).map((d) => d.url);

  // Keep only tokens that are valid on their own: they must not drop a target.
  const usable = [];
  for (const tok of candidateTokens(docs, targets)) {
    let hits;
    try {
      hits = new Set(engine.runQuery(tok, docs));
    } catch {
      continue;
    }
    if (want.every((u) => hits.has(u))) {
      usable.push({ tok, excludes: new Set(nonTargets.filter((u) => !hits.has(u))) });
    }
  }
  // Most-discriminating first, so the shortest working query surfaces early.
  usable.sort((a, b) => b.excludes.size - a.excludes.size);

  const need = new Set(nonTargets);
  const verify = (tokens) => {
    const q = tokens.join(" ");
    let got;
    try {
      got = engine.runQuery(q, docs).sort();
    } catch {
      return null;
    }
    if (got.length !== want.length || got.some((u, i) => u !== want[i])) return null;
    if (engine.tokenizeQuery(q).length > TOKEN_LIMIT) return null;
    return { query: q, tokens, matched: got, extras: [], missing: [] };
  };

  // Exact search over increasing token counts, pruned by remaining coverage.
  for (let k = 1; k <= TOKEN_LIMIT; k++) {
    const found = search([], 0, need, k);
    if (found) return found;
  }
  return null;

  function search(chosen, start, remaining, budget) {
    if (remaining.size === 0) return verify(chosen);
    if (budget === 0) return null;
    for (let i = start; i < usable.length; i++) {
      const cand = usable[i];
      // Prune: even the best remaining tokens cannot finish the cover in time.
      if (cand.excludes.size * budget < remaining.size) return null;
      let progress = false;
      for (const u of cand.excludes) if (remaining.has(u)) { progress = true; break; }
      if (!progress) continue;
      const next = new Set([...remaining].filter((u) => !cand.excludes.has(u)));
      const hit = search([...chosen, cand.tok], i + 1, next, budget - 1);
      if (hit) return hit;
    }
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * The four offline answers, with the evidence behind each one.
 * ------------------------------------------------------------------ */

export async function solveOffline(engine, email, versions = {}) {
  const v = { dorks: "v1", waf: "v1", media: "v1", workflow: "v1", ...versions };
  const out = {};

  const dorkIndex = engine.generateDorkIndex(email, v.dorks);
  const dork = solveDorks(engine, dorkIndex.docs, dorkIndex.targets);
  out["q-google-dorks-advanced"] = {
    answer: dork ? dork.query : null,
    ok: Boolean(dork),
    evidence: {
      documents: dorkIndex.docs.length,
      targets: dorkIndex.targets,
      matched: dork ? dork.matched : [],
      tokens: dork ? dork.tokens : [],
      note: dork
        ? `Matched ${dork.matched.length}/${dorkIndex.targets.length} with ${dork.tokens.length} of ${TOKEN_LIMIT} tokens.`
        : "No query within the token budget reproduced the target set exactly.",
    },
  };

  const waf = engine.generateWafScenario(email, v.waf);
  out["q-cloudflare-waf-bypass"] = {
    answer: `${waf.baseline}|${waf.flipped[0]}|${waf.fixedCount}`,
    ok: true,
    evidence: {
      rules: waf.rules.length,
      requests: waf.requests.length,
      reachingOrigin: waf.baseline,
      swapped: [waf.swapA, waf.swapB],
      flipped: waf.flipped,
      afterExemption: waf.fixedCount,
      overBlockRule: waf.overBlockNumber,
      perRequest: waf.requests.map((r) => ({
        id: r.id,
        verdict: engine.verdictFor(waf.rules, r),
      })),
    },
  };

  const media = engine.generateMediaScenario(email, v.media);
  out["q-media-forensics"] = {
    answer: `${media.imageToken}|${media.audioDigits}|${media.sceneChanges}`,
    ok: true,
    evidence: {
      imageToken: media.imageToken,
      audioDigits: media.audioDigits,
      frameCount: media.frameCount,
      sceneChanges: media.sceneChanges,
      scenes: media.scenes,
      note: "The artefacts are rendered from these values, so no signal analysis is involved.",
    },
  };

  const wf = engine.generateWorkflowScenario(email, v.workflow);
  out["q-actions-workflow-audit"] = {
    answer: `${wf.findings.join(",")}|${wf.previewJob}`,
    ok: true,
    evidence: {
      findings: wf.findings,
      previewJob: wf.previewJob,
      deployJob: wf.deployJob,
      workflow: wf.workflow,
    },
  };

  return out;
}
