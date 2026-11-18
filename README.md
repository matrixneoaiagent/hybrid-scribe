# Hybrid Scribe

A small, honest demo of **hybrid inference with Firebase AI Logic**: summarise notes
with Gemini Nano on the device when Chrome can host it, and fall back to Gemini in
the cloud when it cannot — one SDK, one model instance, one call site.

Built for the [**#BuildHybridAI 2026**](https://firebasehybridaihackathon.devpost.com/) hackathon (Google / Firebase).

![status](https://img.shields.io/badge/status-working%20skeleton-f2a33c)

**Live demo:** https://buildhybridai-2026-neo.web.app

## What it does

- Paste notes, choose an inference mode, press **Summarise**.
- The app calls `model.generateContent()` once. Firebase AI Logic decides whether the
  request runs on the device's Prompt API (Gemini Nano) or against a cloud-hosted
  Gemini model.
- The UI reports exactly which path answered, using `response.inferenceSource`
  (`ON_DEVICE` / `IN_CLOUD`), plus the round-trip time.
- A capability panel shows `LanguageModel.availability()` so you can see whether the
  current browser can host the on-device model.

## Why hybrid

| | On-device (Gemini Nano) | Cloud (Gemini via Firebase AI Logic) |
|---|---|---|
| Cost | free to run | counts against AI Logic quota |
| Privacy | text never leaves the machine | text is sent to Gemini |
| Availability | Chrome 139+ desktop, model downloaded | any supported browser with network |
| Latency | fast once the model is warm | network round-trip |

The point of the demo is that neither column wins alone: the app stays useful on a
locked-down laptop (cloud) and stays private and free on a capable one (on-device).

## Architecture

```
index.html          UI shell
src/main.js         AI Logic service, hybrid model, inference + UI state
src/appcheck.js     App Check (debug provider locally, reCAPTCHA in production)
src/firebase-config.js  public Firebase web config
vite.config.js      dev server / build
firebase.json       Hosting config
```

Only three lines matter for the hackathon requirement:

```js
const ai = getAI(app, { backend: new GoogleAIBackend() });
const model = getGenerativeModel(ai, { mode: InferenceMode.PREFER_ON_DEVICE });
const result = await model.generateContent(prompt); // response.inferenceSource tells you where it ran
```

`initializeDeviceModel()` is called inside the button handler, because Chrome only
allows Prompt API sessions after a user gesture.

## Setup

Requirements: Node 20+, a Firebase project on the **Spark (free)** plan with AI Logic
enabled, and Chrome 139+ on desktop if you want the on-device path.

```bash
npm install
cp .env.local.example .env.local   # then fill in your App Check debug token
npm run dev                        # http://localhost:5173
```

### Firebase configuration

1. Create a Firebase project and a **Web app**, then copy its config into
   `src/firebase-config.js` (these values are public identifiers, not secrets).
2. Open **AI Logic → Get started → Gemini Developer API** and finish the wizard. It
   enables the required APIs and enforces App Check for AI Logic.
3. **App Check → Apps → Register** your web app, then add a **debug token** for local
   development (`firebase appcheck:debugtokens:create --app <appId>`), and put it in
   `.env.local` as `VITE_FIREBASE_APPCHECK_DEBUG_TOKEN`.
4. For a public deployment, register a production attestation provider and set
   `VITE_RECAPTCHA_SITE_KEY` instead of the debug token.

Debug tokens are credentials. `.env.local` is gitignored; never commit it.

### On-device model

Chrome desktop 139+ only. Enable `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`,
restart, then check availability in DevTools:

```js
await LanguageModel.availability(); // "available" | "downloadable" | "downloading" | "unavailable"
```

The first on-device request starts a multi-hundred-MB model download; the UI shows
download progress while `PREFER_ON_DEVICE` silently falls back to the cloud.

## Deploy

```bash
npm run build
firebase deploy --only hosting
```

`firebase.json` publishes `dist/` and rewrites everything to `index.html`.

## Known limitations

- **On-device inference is Chrome-desktop only.** This project was developed on Linux,
  where Chrome's on-device model service is not shipped, so every local run answered
  `IN_CLOUD`. The on-device branch is exercised automatically on a capable machine —
  no code change required.
- On-device requests are single-turn text generation (no chat, no tools), max ~9216
  tokens. Long notes fall back to the cloud.
- `countTokens()` and server prompt templates are not supported by hybrid inference.
- AI monitoring in the Firebase console only shows cloud inference.

## Roadmap

- Register a Fraud Defense (reCAPTCHA Enterprise) provider for the hosted build.
- Add streaming output and a latency comparison view (on-device vs cloud, same prompt).
- Ship the same UI to Android (Gemini Nano via AI Logic) for the cross-platform bonus.

## License

Apache-2.0 — see [LICENSE](LICENSE).
