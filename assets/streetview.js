/**
 * Street View geolocation.
 *
 * This is the one question a language model actually helps with: the image is
 * chosen server-side, so nothing can be derived from the email, but a vision
 * model can name the landmark. Two things matter for the mark:
 *
 *   - the exam wants the CITY, not the landmark's own name. Answering
 *     "Hiroshima Peace Memorial Park" scores zero where "Hiroshima" scores full.
 *   - the pin only needs to be within 100 m, so a landmark's own coordinates are
 *     usually close enough — but not always, so the answer carries a confidence.
 *
 * The token is read from a field, used once against aipipe.org, and never
 * stored or sent anywhere else. There is no server in this project to send it to.
 */

const ENDPOINT = "https://aipipe.org/openrouter/v1/chat/completions";
const MODEL = "google/gemini-2.0-flash-001"; // cheapest vision model on the proxy

const SYSTEM = `You are a precise OSINT geolocation analyst.

You will be shown one Street View photograph. Identify where it was taken.

Report your answer as JSON only, with exactly these keys:
{
  "place": "the CITY or town name, in English",
  "country": "the full country name in English, e.g. 'United States' not 'USA'",
  "lat": <number>,
  "lon": <number>,
  "landmark": "the specific building or feature you recognised, or null",
  "confidence": "high" | "medium" | "low",
  "cues": ["the visual evidence you used, one short phrase each"]
}

Rules that decide whether the answer scores:
- "place" must be the CITY, never the park, museum, street or landmark name.
  If you recognise "Hiroshima Peace Memorial Museum", the place is "Hiroshima".
- "lat"/"lon" must be the camera's position, as precisely as you can place it —
  the exact street corner, not the centre of the city. Being more than 100 metres
  out scores zero, so prefer the specific intersection you can see.
- Use driving side, plate shapes, script and language on signage, road markings,
  utility poles, kerb paint, vegetation and architecture as evidence.
- If you cannot identify it, still give your best guess and set confidence to "low".

Output the JSON object and nothing else.`;

/**
 * @param {{imageUrl?: string, imageDataUrl?: string, token: string, model?: string}} opts
 */
export async function geolocate({ imageUrl, imageDataUrl, token, model = MODEL }) {
  const image = imageDataUrl || imageUrl;
  if (!image) throw new Error("Give the solver the Street View image first.");
  if (!token) throw new Error("An aipipe.org token is needed for this question.");

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            { type: "text", text: "Where was this photograph taken?" },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    if (res.status === 402 || /insufficient credits/i.test(detail)) {
      throw new Error(
        "Your aipipe credits are used up, so this route is closed. Use the free steps above " +
          "instead: copy the image, open gemini.google.com, paste it with the prompt. That costs " +
          "nothing and answers the same question."
      );
    }
    throw new Error(
      res.status === 401
        ? "That token was rejected. Tokens expire when your aipipe session ends — get a fresh one."
        : `aipipe returned HTTP ${res.status}. ${detail.slice(0, 160)}`
    );
  }

  const body = await res.json();
  const text = body?.choices?.[0]?.message?.content ?? "";
  const parsed = parseJson(text);
  if (!parsed) throw new Error("The model did not return usable JSON. Try again.");
  return normalise(parsed);
}

/** Models sometimes wrap JSON in prose or a fence; take the first object. */
function parseJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalise(raw) {
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  return {
    place: String(raw.place ?? "").trim(),
    country: String(raw.country ?? "").trim(),
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    landmark: raw.landmark ? String(raw.landmark).trim() : null,
    confidence: ["high", "medium", "low"].includes(raw.confidence) ? raw.confidence : "low",
    cues: Array.isArray(raw.cues) ? raw.cues.map(String).slice(0, 8) : [],
  };
}

/** The exam wants: Place, Country, Latitude, Longitude — comma separated. */
export function formatAnswer(r) {
  if (!r.place || !r.country || r.lat == null || r.lon == null) return null;
  return `${r.place}, ${r.country}, ${r.lat.toFixed(5)}, ${r.lon.toFixed(5)}`;
}

/**
 * Answers this exam has already accepted, keyed by the image filename. A hit
 * here beats the model every time, because it is a confirmed answer rather than
 * an inference.
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
