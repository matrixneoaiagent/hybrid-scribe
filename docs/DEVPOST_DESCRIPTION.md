# Devpost submission text (draft, < 500 words)

**Hybrid Scribe — an offline-first research assistant that knows which model answered**

Field researchers and students work with long documents in places with bad Wi-Fi. Cloud assistants
upload everything and stop working offline; on-device models are private and free, but only ship on
some machines and have a small context window. Hybrid Scribe treats both as one model with two
execution paths, and never hides which one it used.

## What it does

Drop or paste a document (txt, md, csv, json, up to 200k characters). Hybrid Scribe summarises it with
a chunked map/reduce pass and answers follow-up questions grounded in the most relevant chunks. Every
response carries a badge read straight from Firebase AI Logic's `response.inferenceSource` —
`on-device`, `in cloud`, or `mixed paths` when a long document spans both — plus total and per-call
latency. Saved summaries go to Firestore under an anonymous user id and stay readable offline via the
IndexedDB cache.

## How the hybrid policy works

The app creates one `GenerativeModel` per inference mode with `mode: InferenceMode.PREFER_ON_DEVICE`.
Chrome is asked for a Prompt API session after a user gesture (`initializeDeviceModel()`); if the
device has Gemini Nano, the text never leaves the machine. If there is no model, the download has not
finished, or a chunk exceeds the ~9,216-token on-device window, the same call is served by Gemini in
the cloud. `ONLY_ON_DEVICE` mode is kept as a test switch so the no-model path fails loudly instead of
silently falling back.

Chunk size, chunk cap, default policy and question-context budget come from Remote Config, so the
cost/latency trade-off is tunable without a build.

## Firebase services

- **AI Logic hybrid inference** — summaries, reduce pass and Q&A all run through one call site.
- **App Check** — attestation in front of the Gemini API (debug token on the public demo, as the rules
  allow; Fraud Defence/reCAPTCHA for a production build).
- **Authentication** — anonymous sessions, so a visitor gets a private namespace with no sign-up.
- **Cloud Firestore** — `users/{uid}/notes`, owner-only security rules with bounded field names and
  sizes, plus offline persistence.
- **Remote Config** — five parameters driving chunking and policy.
- **Hosting** — the static Vite build.

## Challenges

Mostly ordering bugs: App Check must be initialised before the AI Logic service is created, or the
first request goes out without a token and the API returns `401 App Check token is invalid`.
`inferenceSource` is lowercase in the JS SDK, so badges normalise it; `countTokens()` cannot be trusted
across paths, so chunking is character-based.

## Testing the device path

Gemini Nano exists on Chrome desktop for Windows, macOS and ChromeOS (139+), not on Linux. A debug flag
(`?debug=1`) forces `PREFER_ON_DEVICE` and logs requested vs. answered path per call, so reviewers can
watch the fallback — and watch it flip to `ON_DEVICE` on a capable machine.

## What's next

Google account linking for durable libraries, streaming output, and an Android build via AI Logic's
Gemini Nano path for the cross-platform bonus.
