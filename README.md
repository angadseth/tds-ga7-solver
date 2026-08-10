# GA7 Solver

Derives the offline answers for the TDS GA7 assignment from your email address, and shows the
evidence behind each one.

**→ https://angadseth.github.io/tds-ga7-solver/**

## How it works

Every TDS question is a pure function of the student's email. The exam builds each variant with a
seeded generator — `questionId # your-email # version` — and that generator ships to the browser as
an ordinary JavaScript module.

This project does not re-implement a single question. It loads that module, rebinds its lazily
aliased RNG so the generators can be called directly, and reads the answers out of the same code
the grader was built from. There is nothing to guess and nothing to drift out of date: if the
course changes a question, the engine follows automatically.

```
generateDorkIndex(email, v)       → { docs, targets }  + runQuery, tokenizeQuery
generateWafScenario(email, v)     → { baseline, flipped, fixedCount, rules, requests }
generateMediaScenario(email, v)   → { imageToken, audioDigits, sceneChanges }
generateWorkflowScenario(email, v)→ { findings, previewJob, deployJob }
```

The media question is the clearest illustration: the PNG, the WAV and the sprite sheet are
*rendered from* those values, so no LSB extraction, FFT or frame differencing is involved at all.

The search-operator question is the one real search problem — the answer is a query, not a value.
Because every token is ANDed, any usable token must match all nine targets, which reduces the
problem to an exact set cover over the documents that still need excluding. Candidates are then
confirmed with the exam's own matcher and only reported on an exact hit inside the token budget.

## What it deliberately does not do

The five policy gates are graded by the exam calling **your** live endpoint with hidden payloads.
Those ten marks cannot be derived from an email by this tool or any other. Anything that claims
otherwise is guessing.

Street View is assisted rather than derived: the image is chosen server-side, so there is nothing to
derive. What the page gives you instead is free and needs no key of any kind —

- a classmate's [answer gallery](https://hypemonk.github.io/Geo-locations/)
  ([@hypemonk](https://github.com/hypemonk/Geo-locations)) — the images this assignment hands out,
  each with a confirmed answer beside it. The image pool is small, so this is usually the whole
  question. Linked first, because finding your image beats identifying it.
- a prompt for whichever chat model you already have open, built around the two things that actually
  decide the mark: the exam wants the **city**, not the landmark's name, and the pin has a 100 m
  tolerance.
- answers this exam has already accepted, cached in `data/streetview.json` by image filename.

## Privacy

There is no server and there is no API key. No email or answer is transmitted anywhere; the site is
a static file and the bookmarklet runs entirely inside your own tab. Your email is kept in
`localStorage` only so you do not have to retype it.

## Development

```bash
npm install
npm run verify     # derives answers and asserts them against known-good ones
npm run vendor     # refresh the vendored generator from the exam origin
python -m http.server 8901   # then open http://localhost:8901
```

`npm run verify` is the safety net: it derives all four answers and compares them against answers
this exam accepted. The dork question is checked on its result set rather than its query text,
because many different queries return the same nine documents and all of them are correct.

## Scope

Built for the graded assignments, whose instructions state that any help you can find is permitted.
Not for the proctored exams, where it must not be used. Independent project; not affiliated with
IIT Madras or the TDS course team.

## Credits

- **Q6 answer gallery** — [hypemonk/Geo-locations](https://github.com/hypemonk/Geo-locations),
  confirmed Street View answers for question six. ⭐ it if it helped.
- **This solver** — [angadseth/tds-ga7-solver](https://github.com/angadseth/tds-ga7-solver). ⭐ it so
  other students find it.
- Angad Jangir · [GitHub @angadseth](https://github.com/angadseth) ·
  [LinkedIn](https://www.linkedin.com/in/angad-jangir-23306231b/)
