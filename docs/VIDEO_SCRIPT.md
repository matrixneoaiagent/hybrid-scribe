# Demo video script — Hybrid Scribe (#BuildHybridAI 2026)

Target: **2:45–3:00**, 1440×900 or 1920×1080, browser at 100% zoom, no personal data on screen.
Record the live site: <https://buildhybridai-2026-neo.web.app>. Have a second window open on
`chrome://version` only if you want to show the Chrome build; otherwise skip it.

Prep before recording:

- `?debug=1` appended to the URL so the debug panel is visible (it proves the forced-device path).
- Sidebar empty (use a fresh incognito profile so the anonymous uid has no notes).
- Close DevTools and other tabs; hide bookmarks bar.
- Have the example document ready — the app has **Load example**, so no copy-paste is needed.

---

## Scene 1 — the problem (0:00–0:20)

**On screen:** the landing view of the app, cursor over the empty document box.

**Voice-over:**
> Field researchers and students work with long documents — survey notes, transcripts, reports — often
> where the network is bad. Cloud assistants upload everything and stop working offline. On-device
> models are private and free, but they only exist on some machines.

---

## Scene 2 — the document (0:20–0:45)

**Actions:**

1. Click **Load example** (fills the Kilkenny bat survey notes, 755 characters).
2. Point at the character counter and the *Document* card.

**Voice-over:**
> Hybrid Scribe takes a document like this — or a dropped .txt/.md/.csv — and does two things:
> summarises it, and answers questions about it. Everything you see here is one call site into
> Firebase AI Logic.

---

## Scene 3 — device capability (0:45–1:05)

**On screen:** right sidebar, **This device** panel.

**Voice-over:**
> Before we run anything, the app asks Chrome whether it can host Gemini Nano. On this Linux machine
> the answer is `unavailable`, so requests will use the cloud fallback. On Chrome for Windows, macOS or
> ChromeOS the same panel says `available`, and the document never leaves the machine.

---

## Scene 4 — summarise, and show the path (1:05–1:40)

**Actions:**

1. Leave the mode on **Prefer on-device → cloud**.
2. Click **Summarise**; let the spinner and status line run.
3. When the result lands, hover the **in cloud** badge, then the latency, then the detail line
   `requested PREFER_ON_DEVICE · answered 1 call (0 on-device, 1 cloud) · cloud model gemini-3.5-flash-lite`.

**Voice-over:**
> One call, `PREFER_ON_DEVICE`. The SDK asked the device for a model, found none, and fell back to
> Gemini in the cloud — and it tells us so in `response.inferenceSource`. The badge is read from that
> field, never guessed. Total time: about two seconds for a page of field notes. Chunk size and the
> chunk cap come from Firebase Remote Config, so this can be tuned without a deploy.

---

## Scene 5 — ask a question (1:40–2:05)

**Actions:**

1. Type into **Ask about this document**: `How many pipistrelle passes were recorded at Site A?`
2. Click **Ask**, wait for the answer.
3. Point at the answer badge, latency and the `chunks 0` note.

**Voice-over:**
> Questions use the same hybrid policy. The app ranks the chunks against the question — no embeddings,
> no extra cost — and sends only the best ones. The answer is grounded: if the document does not say,
> the model is instructed to say so instead of inventing.

---

## Scene 6 — persistence and offline (2:05–2:25)

**Actions:**

1. Click **Save to Firestore**; the note appears in **Saved documents** with its path badge.
2. Click the saved note to restore it.
3. (Optional) DevTools → Network → Offline, reload, show the saved list still renders from the
   IndexedDB cache, then go back online.

**Voice-over:**
> Saved summaries go to Cloud Firestore under an anonymous Firebase Auth user, protected by security
> rules — owner-only, bounded fields. Firestore's IndexedDB cache keeps them readable with no network,
> which is the point of a field tool.

---

## Scene 7 — the forced-device debug flag (2:25–2:45)

**On screen:** the **Debug** panel (visible because of `?debug=1`).

**Actions:**

1. Tick **Force `PREFER_ON_DEVICE`**.
2. Click **Summarise** again on a shorter document (or reuse the example).
3. Point at the debug log line `summary: requested PREFER_ON_DEVICE → IN_CLOUD …`.

**Voice-over:**
> For reviewers without a Windows or macOS machine: this flag forces the device path explicitly. The
> log shows the request was `PREFER_ON_DEVICE` and the answer came from `IN_CLOUD` — the fallback is
> visible rather than hidden. Same build, same code; on a Chrome desktop with the model, that line
> says `ON_DEVICE`.

---

## Scene 8 — close (2:45–3:00)

**On screen:** the **How it works** tab, scrolled to the hybrid diagram.

**Voice-over:**
> Firebase AI Logic gave us one SDK for both paths: App Check on the front, Remote Config tuning the
> policy, Firestore keeping the results, and a single `generateContent` call that works offline or
> online. Hybrid Scribe — built for #BuildHybridAI 2026. The repo and setup notes are in the
> description.

---

## Recording checklist

- [ ] 16:9, 1080p, audio normalised (no clipping, no keyboard noise)
- [ ] No email addresses, tokens, or Devpost/Firebase console tabs visible
- [ ] Badges and the debug log legible at 1080p (zoom to 110% if needed)
- [ ] Under 3:00, uploaded to YouTube as **Public** (not "Unlisted"), English audio
- [ ] Link pasted into the Devpost submission form
