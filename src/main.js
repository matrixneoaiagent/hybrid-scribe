// Hybrid Scribe — UI wiring.
//
// Flow: App Check → anonymous Auth → Remote Config → device probe → user action
// → AI Logic hybrid call → badge + latency → optional Firestore save.

import { appCheckStatus, signIn, loadRemoteConfig } from './firebase.js';
import { summarizeDocument, askQuestion, MODES, CLOUD_MODEL, ON_DEVICE_TOKEN_BUDGET } from './ai.js';
import { saveNote, watchNotes, removeNote } from './notes.js';

const $ = (id) => document.getElementById(id);

const el = {
  authChip: $('auth-chip'),
  authLabel: $('auth-label'),
  authState: $('auth-state'),
  docTitle: $('doc-title'),
  docText: $('doc-text'),
  docStats: $('doc-stats'),
  loadExample: $('load-example'),
  dropzone: $('dropzone'),
  fileInput: $('file-input'),
  dropHint: $('drop-hint'),
  mode: $('mode'),
  run: $('run'),
  policyLine: $('policy-line'),
  progress: $('progress'),
  progressBar: $('progress').firstElementChild,
  composeStatus: $('compose-status'),
  resultCard: $('result-card'),
  summaryBadge: $('summary-badge'),
  summaryLatency: $('summary-latency'),
  summaryPath: $('summary-path'),
  summaryBody: $('summary-body'),
  save: $('save'),
  question: $('question'),
  ask: $('ask'),
  answer: $('answer'),
  answerBadge: $('answer-badge'),
  answerLatency: $('answer-latency'),
  answerText: $('answer-text'),
  answerEmpty: $('answer-empty'),
  deviceState: $('device-state'),
  promptApi: $('prompt-api'),
  appcheckState: $('appcheck-state'),
  downloadModel: $('download-model'),
  deviceNote: $('device-note'),
  rcChunk: $('rc-chunk'),
  rcMax: $('rc-max'),
  rcPolicy: $('rc-policy'),
  rcQa: $('rc-qa'),
  rcMeta: $('rc-meta'),
  notesList: $('notes-list'),
  notesCount: $('notes-count'),
  notesEmpty: $('notes-empty'),
  debugCard: $('debug-card'),
  forceDevice: $('force-device'),
  debugLog: $('debug-log'),
  footerBuild: $('footer-build'),
};

const state = {
  user: null,
  config: null,
  last: null, // { title, text, summary, source, latencyMs, chunks, question, answer }
  busy: false,
  forceDevice: false,
  appCheck: 'not initialised',
};

const params = new URLSearchParams(location.search);
const debugMode = params.get('debug') === '1' || params.has('force-device');
state.forceDevice = params.get('force-device') === '1' || params.get('force') === 'on-device';

// ── small helpers ─────────────────────────────────────────────────────────
const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`);
const fmtDate = (d) =>
  d ? d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

function badgeKind(source) {
  if (source === 'ON_DEVICE') return 'device';
  if (source === 'IN_CLOUD') return 'cloud';
  if (source === 'MIXED') return 'mixed';
  return 'unknown';
}

function labelFor(source) {
  return (
    {
      ON_DEVICE: 'on-device',
      IN_CLOUD: 'in cloud',
      MIXED: 'mixed paths',
      UNKNOWN: 'unknown',
    }[source] || source || 'unknown'
  );
}

function setBadge(node, source) {
  node.className = `badge ${badgeKind(source)}`;
  node.textContent = labelFor(source);
}

function debug(msg) {
  const line = `${new Date().toISOString().slice(11, 19)}  ${msg}`;
  el.debugLog.textContent = `${line}\n${el.debugLog.textContent}`.slice(0, 4000);
  if (debugMode) console.debug('[hybrid]', msg);
}

function setProgress(ratio, visible = true) {
  el.progress.hidden = !visible;
  el.progressBar.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
}

function updateDocStats() {
  const chars = el.docText.value.length;
  const words = el.docText.value.trim() ? el.docText.value.trim().split(/\s+/).length : 0;
  el.docStats.textContent = `${chars.toLocaleString()} characters · ${words.toLocaleString()} words`;
  if (!el.docTitle.value && chars === 0) el.docTitle.placeholder = 'e.g. Field notes — Kilkenny bat survey';
}

// ── boot ──────────────────────────────────────────────────────────────────
function switchView(name) {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('is-active', tab.dataset.view === name);
  });
  $('view-scribe').hidden = name !== 'scribe';
  $('view-how').hidden = name !== 'how';
  if (name === 'how') window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => switchView(tab.dataset.view));
});

el.footerBuild.textContent = `v0.2.0 · ${new Date().getFullYear()}`;

state.appCheck = appCheckStatus;
el.appcheckState.textContent = state.appCheck;
debug(`App Check: ${state.appCheck}`);

// Auth + Firestore subscription.
signIn().then((user) => {
  state.user = user;
  el.authChip.classList.add('is-ready');
  el.authLabel.textContent = 'anonymous session';
  el.authState.textContent = `${user.uid.slice(0, 6)}…`;
  debug(`Auth: anonymous uid ${user.uid.slice(0, 8)}…`);
  const unsub = watchNotes(
    user.uid,
    (notes) => renderNotes(notes),
    (err) => {
      console.warn('[notes] snapshot failed', err);
      el.notesEmpty.textContent = `Could not load saved documents (${err?.code || 'error'}).`;
    },
  );
  addEventListener('pagehide', unsub, { once: true });
});

// Remote Config: drives chunking + default policy.
loadRemoteConfig().then((config) => {
  state.config = config;
  el.rcChunk.textContent = `${config.chunkSize} chars`;
  el.rcMax.textContent = String(config.maxChunks);
  el.rcPolicy.textContent = config.policy;
  el.rcQa.textContent = `${config.qaContextChars} chars`;
  el.rcMeta.textContent = `${config.status} · ${config.fetchedInMs} ms`;
  el.mode.value = config.policy === 'prefer_in_cloud' ? 'PREFER_IN_CLOUD' : 'PREFER_ON_DEVICE';
  updatePolicyLine();
  debug(`Remote Config: ${config.status} chunk=${config.chunkSize} max=${config.maxChunks} policy=${config.policy}`);
});

function updatePolicyLine() {
  const c = state.config;
  if (!c) return;
  el.policyLine.textContent =
    `Policy: ${el.mode.value === 'ONLY_IN_CLOUD' ? 'cloud only' : el.mode.value === 'PREFER_IN_CLOUD' ? 'cloud first' : 'device first'} · ` +
    `chunks of ${c.chunkSize} chars, max ${c.maxChunks} · on-device window ${ON_DEVICE_TOKEN_BUDGET.toLocaleString()} tokens`;
}
el.mode.addEventListener('change', updatePolicyLine);

// Device capability probe.
async function probeDevice() {
  if (typeof self.LanguageModel === 'undefined') {
    el.deviceState.textContent = 'not available';
    el.promptApi.textContent = 'absent';
    el.deviceNote.textContent =
      'This browser has no Chrome Prompt API. Every request will be served by Gemini in the cloud.';
    return;
  }
  el.promptApi.textContent = 'present';
  try {
    const availability = await self.LanguageModel.availability();
    el.deviceState.textContent = availability;
    if (availability === 'downloadable') {
      el.deviceNote.textContent = 'The on-device model can be downloaded (a few hundred MB, one time).';
      el.downloadModel.hidden = false;
    } else if (availability === 'downloading') {
      el.deviceNote.textContent = 'Model download in progress — requests fall back to cloud until it finishes.';
    } else if (availability === 'available') {
      el.deviceNote.textContent = 'On-device model ready. Requests marked “on-device” never leave this machine.';
    } else {
      el.deviceNote.textContent =
        'Chrome reports the on-device model as unavailable on this build. Requests fall back to Gemini in the cloud.';
    }
    debug(`LanguageModel.availability() = ${availability}`);
  } catch (err) {
    el.deviceState.textContent = 'probe failed';
    el.deviceNote.textContent = String(err?.message || err);
  }
}
probeDevice();

el.downloadModel.addEventListener('click', async () => {
  el.downloadModel.disabled = true;
  el.downloadModel.textContent = 'Downloading…';
  try {
    await self.LanguageModel.create({
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          el.deviceState.textContent = `downloading ${Math.round(e.loaded * 100)}%`;
        });
      },
    });
    await probeDevice();
  } catch (err) {
    el.deviceState.textContent = 'download failed';
    el.deviceNote.textContent = String(err?.message || err);
  } finally {
    el.downloadModel.disabled = false;
    el.downloadModel.textContent = 'Download on-device model';
  }
});

// Debug panel.
if (debugMode) {
  el.debugCard.hidden = false;
  el.forceDevice.checked = state.forceDevice;
}
el.forceDevice.addEventListener('change', () => {
  state.forceDevice = el.forceDevice.checked;
  if (state.forceDevice) {
    el.mode.value = 'PREFER_ON_DEVICE';
    updatePolicyLine();
  }
  debug(`force on-device = ${state.forceDevice}`);
});

// ── document input ────────────────────────────────────────────────────────
const EXAMPLE = {
  title: 'Kilkenny bat survey — field notes',
  text: `Kilkenny Bat Survey — field notes, 12-14 November 2026

Site A (river meadow). Two Anabat detectors deployed at 17:40 on 12 November. Air temperature 9.1 C at dusk, falling to 4.4 C by 23:00. Wind SW 2 m/s. First pass by a common pipistrelle (Pipistrellus pipistrellus) at 18:12, 34 minutes after sunset. Peak activity between 18:30 and 19:10 with 41 passes recorded.

Site B (churchyard). Detector one failed at 21:05 due to water ingress; replaced on 13 November. Lesser horseshoe (Rhinolophus hipposideros) recorded twice, at 19:48 and 20:31, both near the north porch. This is the first record for the churchyard since 2019.

Weather on 13 November: rain from 16:00 to 20:15, survey suspended. On 14 November conditions improved: 7.8 C, calm, clear. Soprano pipistrelle activity high along the eastern hedgerow, 63 passes in 90 minutes.

Conclusion: the river meadow remains the primary foraging corridor. The churchyard should be resurveyed in spring 2027, with two detectors and a spare battery pack. Recommend no lighting changes near the north porch until the lesser horseshoe roost status is confirmed.`,
};

el.loadExample.addEventListener('click', () => {
  el.docTitle.value = EXAMPLE.title;
  el.docText.value = EXAMPLE.text;
  updateDocStats();
});

el.docText.addEventListener('input', updateDocStats);
updateDocStats();

async function readFile(file) {
  const text = await file.text();
  el.docText.value = text.slice(0, 200000);
  if (!el.docTitle.value) {
    el.docTitle.value = file.name.replace(/\.[^.]+$/, '').slice(0, 120);
  }
  el.dropHint.textContent = `Loaded ${file.name} · ${(file.size / 1024).toFixed(1)} KB`;
  updateDocStats();
  debug(`Loaded file ${file.name} (${file.size} bytes)`);
}

el.dropzone.addEventListener('click', (event) => {
  if (event.target === el.docText) return;
  el.fileInput.click();
});
el.dropzone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target === el.dropzone) el.fileInput.click();
});
el.fileInput.addEventListener('change', () => {
  if (el.fileInput.files?.[0]) readFile(el.fileInput.files[0]);
});

['dragenter', 'dragover'].forEach((type) =>
  el.dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    el.dropzone.classList.add('is-drag');
  }),
);
['dragleave', 'drop'].forEach((type) =>
  el.dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    el.dropzone.classList.remove('is-drag');
  }),
);
el.dropzone.addEventListener('drop', (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (file) readFile(file);
});

// ── summarise ─────────────────────────────────────────────────────────────
function currentMode() {
  const key = state.forceDevice ? 'PREFER_ON_DEVICE' : el.mode.value;
  return { key, value: MODES[key] };
}

el.run.addEventListener('click', async () => {
  if (state.busy) return;
  const text = el.docText.value.trim();
  if (text.length < 40) {
    el.composeStatus.textContent = 'Add a document first (at least a paragraph).';
    return;
  }
  state.busy = true;
  el.run.disabled = true;
  el.run.textContent = 'Working…';
  el.composeStatus.textContent = '';
  el.answer.hidden = true;
  el.answerEmpty.hidden = true;
  el.resultCard.hidden = false;
  setProgress(0.02);

  const mode = currentMode();
  const config = state.config || { chunkSize: 1800, maxChunks: 6, qaContextChars: 4000, summaryStyle: 'bullets' };
  if (state.forceDevice) debug('Debug: forcing PREFER_ON_DEVICE request');

  try {
    const result = await summarizeDocument({
      text,
      mode: mode.value,
      chunkSize: config.chunkSize,
      maxChunks: config.maxChunks,
      style: config.summaryStyle,
      onProgress: ({ done, total, label }) => {
        setProgress(total ? done / total : 0.1);
        el.composeStatus.textContent = label;
      },
    });

    setProgress(1, false);
    renderSummary(result, text, mode.key);
    const failed = result.perCall.filter((c) => c.source === 'ERROR').length;
    el.composeStatus.textContent =
      `Done: ${result.chunks} of ${result.totalChunks} chunk${result.totalChunks === 1 ? '' : 's'} summarised` +
      (result.truncated ? ' (document truncated to the chunk cap)' : '') +
      (failed ? ` · ${failed} call(s) failed` : '') +
      '.';
    debug(
      `summary: requested ${mode.key} → ${result.source} · ${result.perCall
        .map((c) => `${c.source}/${c.latencyMs}ms`)
        .join(', ')}`,
    );
  } catch (err) {
    setProgress(0, false);
    el.composeStatus.textContent = `Failed: ${err?.message || err}`;
    debug(`summary error: ${err?.message || err}`);
  } finally {
    state.busy = false;
    el.run.disabled = false;
    el.run.textContent = 'Summarise';
  }
});

function renderSummary(result, text, requestedMode) {
  const deviceCalls = result.perCall.filter((c) => c.source === 'ON_DEVICE').length;
  const cloudCalls = result.perCall.filter((c) => c.source === 'IN_CLOUD').length;

  state.last = {
    title: el.docTitle.value.trim() || 'Untitled document',
    text,
    summary: result.summary,
    source: result.source,
    latencyMs: result.latencyMs,
    chunks: result.chunks,
    question: '',
    answer: '',
  };

  setBadge(el.summaryBadge, result.source);
  el.summaryLatency.textContent = `${fmtMs(result.latencyMs)} total`;
  el.summaryPath.innerHTML = '';
  const detail = document.createElement('span');
  detail.innerHTML =
    `requested <code>${requestedMode}</code> · answered ${result.perCall.length} call${result.perCall.length === 1 ? '' : 's'} ` +
    `(${deviceCalls} on-device, ${cloudCalls} cloud) · cloud model <code>${CLOUD_MODEL}</code>`;
  el.summaryPath.append(detail);

  el.summaryBody.textContent = result.summary;
  el.save.disabled = false;
}

// ── ask ───────────────────────────────────────────────────────────────────
el.question.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el.ask.click();
});

el.ask.addEventListener('click', async () => {
  if (state.busy) return;
  const question = el.question.value.trim();
  if (!question) {
    el.question.focus();
    return;
  }
  if (!state.last) {
    el.composeStatus.textContent = 'Summarise the document first.';
    return;
  }
  state.busy = true;
  el.ask.disabled = true;
  el.ask.textContent = 'Asking…';
  const mode = currentMode();
  const config = state.config || { chunkSize: 1800, maxChunks: 6, qaContextChars: 4000 };

  try {
    const result = await askQuestion({
      text: state.last.text,
      question,
      mode: mode.value,
      chunkSize: config.chunkSize,
      maxChunks: config.maxChunks,
      contextChars: config.qaContextChars,
    });
    setBadge(el.answerBadge, result.source);
    el.answerLatency.textContent = `${fmtMs(result.latencyMs)} · chunks ${result.usedChunks.join(', ')}`;
    el.answerText.textContent = result.text;
    el.answer.hidden = false;
    el.answerEmpty.hidden = true;
    state.last.question = question;
    state.last.answer = result.text;
    debug(`ask: requested ${mode.key} → ${result.source} in ${result.latencyMs} ms`);
  } catch (err) {
    el.answerText.textContent = `Failed: ${err?.message || err}`;
    el.answer.hidden = false;
    debug(`ask error: ${err?.message || err}`);
  } finally {
    state.busy = false;
    el.ask.disabled = false;
    el.ask.textContent = 'Ask';
  }
});

// ── save / notes ──────────────────────────────────────────────────────────
el.save.addEventListener('click', async () => {
  if (!state.user || !state.last) return;
  el.save.disabled = true;
  el.save.textContent = 'Saving…';
  try {
    await saveNote(state.user.uid, state.last);
    el.save.textContent = 'Saved';
    setTimeout(() => {
      el.save.textContent = 'Save to Firestore';
    }, 1800);
  } catch (err) {
    el.save.textContent = 'Save failed';
    debug(`save error: ${err?.code || ''} ${err?.message || err}`);
    setTimeout(() => {
      el.save.textContent = 'Save to Firestore';
      el.save.disabled = false;
    }, 2200);
  }
});

function renderNotes(notes) {
  el.notesList.innerHTML = '';
  el.notesCount.textContent = String(notes.length);
  el.notesEmpty.hidden = notes.length > 0;
  if (notes.length === 0) {
    el.notesEmpty.textContent = 'Summaries you keep are stored in Firestore under your anonymous user id.';
  }
  for (const note of notes) {
    const li = document.createElement('li');
    li.className = 'note';

    const load = document.createElement('button');
    load.className = 'load';
    load.type = 'button';
    load.textContent = note.title;
    load.title = note.title;
    load.addEventListener('click', () => {
      el.docTitle.value = note.title;
      el.docText.value = note.text;
      updateDocStats();
      el.resultCard.hidden = false;
      setBadge(el.summaryBadge, note.source);
      el.summaryLatency.textContent = `${fmtMs(note.latencyMs || 0)} total`;
      el.summaryPath.textContent = `restored from Firestore · ${note.chunks || 1} chunk(s)`;
      el.summaryBody.textContent = note.summary;
      state.last = {
        title: note.title,
        text: note.text,
        summary: note.summary,
        source: note.source,
        latencyMs: note.latencyMs || 0,
        chunks: note.chunks || 1,
        question: note.question || '',
        answer: note.answer || '',
      };
      if (note.answer) {
        setBadge(el.answerBadge, note.source);
        el.answerLatency.textContent = 'saved answer';
        el.answerText.textContent = note.answer;
        el.answer.hidden = false;
        el.answerEmpty.hidden = true;
      } else {
        el.answer.hidden = true;
        el.answerEmpty.hidden = false;
      }
      if (note.question) el.question.value = note.question;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    const meta = document.createElement('span');
    meta.className = 'meta';
    const kind = document.createElement('span');
    kind.className = `badge ${badgeKind(note.source)}`;
    kind.textContent = labelFor(note.source);
    meta.append(kind, document.createTextNode(fmtDate(note.createdAt)));

    const del = document.createElement('button');
    del.className = 'del';
    del.type = 'button';
    del.title = 'Delete';
    del.textContent = '×';
    del.addEventListener('click', async () => {
      if (!state.user) return;
      del.disabled = true;
      await removeNote(state.user.uid, note.id).catch((err) => debug(`delete error: ${err?.message}`));
    });

    li.append(load, del, meta);
    el.notesList.append(li);
  }
}

// Kick off auth UI state even if the network is slow.
setTimeout(() => {
  if (!state.user) {
    el.authLabel.textContent = 'offline (no session)';
    el.authState.textContent = 'anonymous sign-in pending';
  }
}, 6000);

