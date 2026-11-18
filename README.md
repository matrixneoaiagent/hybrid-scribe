# Hybrid Scribe

**An offline-first research assistant for students and field researchers.** Paste or drop a long
document; Hybrid Scribe summarises it and answers questions about it. It prefers the on-device
Gemini Nano model through **Firebase AI Logic hybrid inference**, and transparently falls back to
Gemini in the cloud when the device has no model — always showing which path answered and how long
it took.

Live demo · <https://buildhybridai-2026-neo.web.app>
Built for **#BuildHybridAI 2026** (Google / Firebase) · Apache-2.0

---

## Why this exists

Field notes, transcripts and reports are long, personal, and often written where the Wi-Fi is bad.
A cloud-only assistant stops working in a basement or a nature reserve and uploads everything it
touches. A device-only assistant is private and free, but Gemini Nano only ships on some desktops
and has a ~9,216-token window.

Hybrid Scribe treats both as one model with two execution paths:

| | On-device (Gemini Nano) | Cloud (Gemini via AI Logic) |
|---|---|---|
| Cost | free, unlimited | counts against the AI Logic quota |
| Privacy | the document never leaves the machine | the document is sent to Gemini |
| Availability | Chrome 139+ desktop, model downloaded | any supported browser with network |
| Context | ~9,216 tokens per request | far larger, chunked anyway |

The app stays useful on a machine without the model (cloud), and stays private and free on a machine
that has it (device) — without two code paths in the UI.

---

## What it does

- **Drop or paste a document** (`.txt`, `.md`, `.csv`, `.json`, up to 200k characters).
- **Summarise** — chunked map/reduce. Chunk size and the chunk cap come from **Remote Config**.
- **Ask questions** — grounded in the most relevant chunks, with an explicit "the document does not
  say" instruction instead of invented answers.
- **See the path** — a badge per response (`on-device` / `in cloud` / `mixed paths`) read from
  `response.inferenceSource`, plus total and per-call latency.
- **Keep notes** — saved to **Cloud Firestore** under the visitor's anonymous user id, listed in the
  sidebar, restorable with one click, deletable.
- **Works offline** — Firestore's IndexedDB cache keeps saved notes readable without a network.
- **Explains itself** — a built-in *How it works* page with the hybrid diagram and the limits.

Screenshots live in [`docs/screenshots/`](docs/screenshots).

---

## Architecture

```
index.html                  shell, Scribe + How it works views
src/firebase.js             app, App Check, anonymous Auth, Firestore (IndexedDB cache), Remote Config
src/ai.js                   hybrid model, chunking, map/reduce summary, grounded Q&A
src/notes.js                Firestore CRUD for users/{uid}/notes
src/main.js                 UI state, badges, latency, debug panel
src/firebase-config.js      public web config (identifiers, not secrets)
firestore.rules             owner-only access, bounded fields and sizes
firebase.json               Hosting (dist/) + Firestore rules
```

### The hybrid call

```js
const ai = getAI(app, { backend: new GoogleAIBackend() });

const model = getGenerativeModel(ai, {
  mode: InferenceMode.PREFER_ON_DEVICE,          // device first, cloud fallback
  inCloudParams: { model: 'gemini-3.5-flash-lite' },
  onDeviceParams: {
    createOptions: {
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
    },
  },
});

await model.initializeDeviceModel(progress => …); // after a user gesture
const result = await model.generateContent(prompt);
result.response.inferenceSource;                  // 'on_device' | 'in_cloud'
```

- `initializeDeviceModel()` is called inside the click handler: Chrome only allows a Prompt API
  session after a user gesture. It is fire-and-forget in `PREFER_*` modes so the first request can
  fall back to the cloud while the model downloads.
- In `ONLY_ON_DEVICE` mode the request fails loudly instead of falling back, which is how the
  no-model case is surfaced for testing.
- The SDK's `inferenceSource` is normalised to `ON_DEVICE` / `IN_CLOUD`; a multi-call document that
  mixes paths reports `MIXED`, and the detail line shows the per-call split.

### Chunking and reduce

`chunk_size` (default 1800 chars) and `max_chunks` (default 6) come from Remote Config. Paragraphs
are packed greedily; oversized paragraphs are split on sentence boundaries. Each chunk is summarised
(the *map* step), then a single *reduce* prompt merges the partial summaries, keeping names, numbers
and dates. Documents longer than `chunk_size × max_chunks` are truncated with a visible notice.

### Grounded Q&A

The question is tokenised, stop-worded and scored against the chunks (term frequency, no embeddings,
no extra cost). The best chunks are packed up to `qa_context_chars` and sent with an instruction to
answer only from those excerpts — or to say that the document does not say.

---

## Firebase services, and where they are called

| Service | Used for | Code |
|---|---|---|
| **AI Logic (hybrid inference)** | every summary, reduce and question call | `src/ai.js` |
| **App Check** | attests requests to the Gemini API; debug token for local/dev, Fraudd Defence/reCAPTCHA for a public build | `src/firebase.js` |
| **Authentication** | anonymous session → private Firestore namespace, no sign-up | `src/firebase.js` |
| **Cloud Firestore** | `users/{uid}/notes` documents + IndexedDB offline cache | `src/notes.js` |
| **Remote Config** | `chunk_size`, `max_chunks`, `hybrid_policy`, `qa_context_chars`, `summary_style` | `src/firebase.js` |
| **Hosting** | the static Vite build | `firebase.json` |

Security rules (`firestore.rules`) restrict each user to their own subtree and bound the document
shape, so a forged client cannot write outside `users/{uid}` or paste unbounded blobs.

---

## Setup

Requirements: Node 20+, a Firebase project on the **Spark (free)** plan with AI Logic enabled, and
Chrome 139+ on Windows/macOS/ChromeOS if you want the on-device path.

```bash
npm install
cp .env.local.example .env.local     # add your App Check debug token
npm run dev                          # http://localhost:5173
```

### 1. Firebase project

1. Create a project and a **Web app**; copy the config into `src/firebase-config.js`.
2. **AI Logic → Get started → Gemini Developer API** — enables the APIs and enforces App Check.
3. **Authentication → Sign-in method → Anonymous → Enable.**
4. **Firestore → Create database** (production mode is fine, rules are deployed next).
5. **App Check → Apps → Register** the web app, then create a debug token:
   ```bash
   firebase appcheck:debugtokens:create --app <appId> --display-name hybridai-local
   ```
   Put it in `.env.local` as `VITE_FIREBASE_APPCHECK_DEBUG_TOKEN`.
6. Remote Config parameters (console, or `PUT` the template):

   | Key | Type | Default | Meaning |
   |---|---|---|---|
   | `chunk_size` | number | `1800` | characters per summarisation chunk |
   | `max_chunks` | number | `6` | chunks summarised per document |
   | `hybrid_policy` | string | `prefer_on_device` | default inference mode |
   | `qa_context_chars` | number | `4000` | context budget for a question |
   | `summary_style` | string | `bullets` | `bullets` or `prose` |

### 2. Deploy

```bash
npm run build
firebase deploy --only hosting,firestore:rules
```

`.firebaserc` points at the demo project; change it for your own.

---

## Testing the on-device branch

Nobody should have to take "it works on-device" on faith. Two things make it checkable:

1. **The device panel** shows `LanguageModel.availability()` (and a download button when the model
   is `downloadable`).
2. **The debug flag**: open `?debug=1` (or `?force-device=1`) to reveal a panel with *Force
   `PREFER_ON_DEVICE`*. Every request then explicitly asks for the device path, the debug log prints
   the requested vs. answered path per call, and the badge shows the fallback when a device has no
   model:
   ```
   21:47:16  summary: requested PREFER_ON_DEVICE → IN_CLOUD · IN_CLOUD/1280ms
   21:47:51  ask:     requested PREFER_ON_DEVICE → IN_CLOUD in 1467 ms
   ```
   This is exactly how the demo video was recorded on Linux.

**Where Gemini Nano exists:** Chrome desktop on Windows, macOS and ChromeOS, version 139+, with
`chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` enabled. Linux Chrome/Chromium builds do
not include the model service, so `LanguageModel.availability()` returns `unavailable` there and every
request correctly falls back to the cloud.

---

## Limits and design decisions

- On-device inference is **single-turn text only** — no chat history, no tools, no function calling.
- On-device context is **~9,216 tokens**; chunking keeps each request inside it, and the chunk cap
  keeps cost predictable.
- `countTokens()` is not supported by hybrid inference (counts differ per path), so chunking is
  character-based.
- Console AI monitoring only records cloud inference; the UI is the source of truth for the path.
- The public demo uses an App Check **debug token** (explicitly allowed by the hackathon rules). A
  production build should register Fraud Defence / reCAPTCHA and set `VITE_RECAPTCHA_SITE_KEY`.
- Anonymous accounts expire with the browser profile; notes are per-session by design. Linking a
  Google account would be the next step for durable libraries.

---

## Privacy

Documents are only persisted when you press **Save to Firestore**, under your anonymous uid, and are
deletable from the sidebar. When a request is served on-device, the text is not sent to Google; when
it is served in the cloud, it goes to the Gemini API under the project's quota.

---

## License

Apache-2.0 — see [LICENSE](LICENSE).
