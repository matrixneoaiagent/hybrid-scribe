# Devpost submission checklist — #BuildHybridAI 2026

Deadline: **2026-11-30 14:00 PT** (22:00 UTC / 2026-12-01 00:00 EET). Submission page:
<https://devpost.com/submit-to/31808-buildhybridai-2026/manage/submissions>

## Fields on the submission form

| Field | Value / action | Done |
|---|---|---|
| Project name | `Hybrid Scribe` | ☐ |
| Elevator pitch / tagline | `Offline-first research assistant: summarises and answers questions about long documents on-device, falling back to Gemini in the cloud — and shows which path answered.` | ☐ |
| "Built with" tags | `firebase`, `firebase-ai-logic`, `gemini`, `gemini-nano`, `firestore`, `firebase-auth`, `firebase-remote-config`, `firebase-app-check`, `vite`, `javascript` | ☐ |
| Project URL (demo) | <https://buildhybridai-2026-neo.web.app> | ☐ |
| Code repository | <https://github.com/matrixneoaiagent/hybrid-scribe> (public, Apache-2.0, license visible in About) | ☐ |
| Video demo | YouTube, **Public**, ≤ 3:00, script in [`VIDEO_SCRIPT.md`](VIDEO_SCRIPT.md) | ☐ |
| Description | Text from [`DEVPOST_DESCRIPTION.md`](DEVPOST_DESCRIPTION.md), < 500 words | ☐ |
| Testing instructions | See below | ☐ |
| Team / participants | Matrix Neo (solo) | ☐ |
| Country of residence | Moldova | ☐ |
| Category | Web / Chrome (single platform) | ☐ |
| Previously submitted? | No — new project started 2026-11-18, within the submission period | ☐ |

## Testing instructions (paste into Devpost)

1. Open <https://buildhybridai-2026-neo.web.app> in Chrome (desktop).
2. Press **Load example**, then **Summarise**. A summary appears with a path badge (`in cloud` on a
   machine without Gemini Nano) and latency.
3. Ask `How many pipistrelle passes were recorded at Site A?` — the answer is grounded in the document.
4. Press **Save to Firestore**; the note appears in *Saved documents*.
5. Open `https://buildhybridai-2026-neo.web.app/?debug=1` to reveal the debug panel and tick
   **Force `PREFER_ON_DEVICE`**; the log shows `requested PREFER_ON_DEVICE → IN_CLOUD`, i.e. the
   fallback is visible.
6. On Chrome desktop for Windows/macOS/ChromeOS (139+) with
   `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` enabled, the same steps answer
   `on_device` instead.
7. No login required: the app signs the visitor in anonymously. The demo uses an App Check debug
   token, which the rules explicitly allow for submissions.

## Pre-submit checks

- [ ] `npm run build` clean, no console errors on the live site
- [ ] Repo has `README.md`, `LICENSE` (Apache-2.0), `firestore.rules`, and no `.env.local`
- [ ] `git log` shows work during the submission period (started 2026-11-18)
- [ ] Video is ≤ 3:00 and set to Public on YouTube
- [ ] Description mentions each Firebase product actually used
- [ ] Disclose pre-existing code: none beyond the Vite template and the Firebase SDK
- [ ] Screenshots in `docs/screenshots/` are current
- [ ] Devpost project saved as draft → reviewed → submitted (operator only)

## Evidence links for the description

- Hybrid call: `src/ai.js` (`buildModel`, `summarizeDocument`, `askQuestion`)
- App Check ordering fix: `src/firebase.js` (`appCheckStatus = initAppCheck()` before `getAI`)
- Firestore rules: `firestore.rules`
- Remote Config parameters: `README.md` → Setup step 6
