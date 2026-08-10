/**
 * Street View geolocation — free routes only.
 *
 * This is the one question nothing can derive: the image is chosen server-side,
 * so there is no email-seeded value to read. What this module carries instead is
 * the two things that decide the mark, plus the answers already confirmed:
 *
 *   - the exam wants the CITY, not the landmark's own name. Answering
 *     "Hiroshima Peace Memorial Park" scores zero where "Hiroshima" scores full.
 *   - the pin only needs to be within 100 m, so a landmark's own coordinates are
 *     usually close enough — but not always, so check before you save.
 *
 * No API key, no token, no paid credits: the work happens in whichever chat
 * model you already have open, or against the reference map linked on the page.
 */

/** The exam wants: Place, Country, Latitude, Longitude — comma separated. */
export function formatAnswer(r) {
  if (!r.place || !r.country || r.lat == null || r.lon == null) return null;
  return `${r.place}, ${r.country}, ${Number(r.lat).toFixed(5)}, ${Number(r.lon).toFixed(5)}`;
}

/**
 * Answers this exam has already accepted, keyed by the image filename. A hit
 * here is a confirmed answer rather than an inference, so it beats any model.
 */
let knownCache = null;
export async function lookupKnown(imageUrl) {
  if (!imageUrl) return null;
  knownCache ??= await fetch(new URL("../data/streetview.json", import.meta.url))
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  const file = imageUrl.split("/").pop()?.split("?")[0];
  const hit = file && knownCache[file];
  return hit ? { ...hit, confidence: "confirmed", cues: ["Previously accepted by the exam."] } : null;
}
