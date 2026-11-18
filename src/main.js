// Firebase AI Logic — hybrid inference (Web / Chrome)
// Docs: https://firebase.google.com/docs/ai-logic/hybrid/web/get-started
//
// On-device inference uses Chrome's built-in Prompt API (Gemini Nano, Chrome 139+
// on desktop). When the device model is unavailable the same GenerativeModel
// instance falls back to a cloud-hosted Gemini model.

import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
} from 'firebase/ai';
import { app, initAppCheck } from './appcheck.js';

// ---------------------------------------------------------------------------
// App Check
// ---------------------------------------------------------------------------
// Debug tokens are registered per app in the Firebase console and are only used
// for local development / judging. The value comes from .env.local and is never
// committed. See src/appcheck.js.
let appCheckState = 'not initialised';
try {
  appCheckState = initAppCheck();
} catch (err) {
  appCheckState = `error: ${err.message}`;
}

// ---------------------------------------------------------------------------
// AI Logic service + hybrid model
// ---------------------------------------------------------------------------
const ai = getAI(app, { backend: new GoogleAIBackend() });

const MODES = {
  PREFER_ON_DEVICE: InferenceMode.PREFER_ON_DEVICE,
  ONLY_ON_DEVICE: InferenceMode.ONLY_ON_DEVICE,
  PREFER_IN_CLOUD: InferenceMode.PREFER_IN_CLOUD,
  ONLY_IN_CLOUD: InferenceMode.ONLY_IN_CLOUD,
};

function buildModel(modeKey) {
  return getGenerativeModel(ai, {
    mode: MODES[modeKey],
    // Cloud-hosted fallback (default is gemini-3.5-flash-lite on SDK v13+).
    inCloudParams: { model: 'gemini-3.5-flash-lite' },
    // On-device Prompt API session options.
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
      },
    },
  });
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const els = {
  device: $('device-status'),
  appcheck: $('appcheck-status'),
  source: $('inference-source'),
  prompt: $('prompt'),
  mode: $('mode'),
  run: $('run'),
  result: $('result-panel'),
  badge: $('badge'),
  meta: $('meta'),
  output: $('output'),
  error: $('error-panel'),
  errorOutput: $('error-output'),
  sdk: $('sdk-version'),
};

els.appcheck.textContent = appCheckState;
els.sdk.textContent = 'firebase-js-sdk 13.x';

async function probeDeviceModel() {
  if (typeof self.LanguageModel === 'undefined') {
    els.device.textContent = 'Prompt API unavailable (needs Chrome 139+ desktop)';
    els.device.dataset.state = 'unavailable';
    return;
  }
  try {
    const availability = await self.LanguageModel.availability();
    els.device.textContent = availability;
    els.device.dataset.state = availability;
  } catch (err) {
    els.device.textContent = `probe failed: ${err.message}`;
  }
}
probeDeviceModel();

const PROMPT_TEMPLATE = (text) =>
  `Summarise the following notes in at most five short bullet points. ` +
  `Keep names, numbers and dates. Reply with the bullets only.\n\n${text}`;

els.run.addEventListener('click', async () => {
  const modeKey = els.mode.value;
  const input = els.prompt.value.trim();
  if (!input) return;

  els.run.disabled = true;
  els.run.textContent = 'Running…';
  els.result.hidden = true;
  els.error.hidden = true;
  els.badge.className = 'badge unknown';
  els.badge.textContent = 'running';

  const model = buildModel(modeKey);
  const started = performance.now();

  try {
    // Must happen after a user gesture and before generateContent().
    // Starts the Gemini Nano download in the background when needed.
    await model.initializeDeviceModel((progress) => {
      els.meta.textContent = `downloading device model… ${Math.round(progress * 100)}%`;
    }).catch(() => {
      /* Only fatal in ONLY_ON_DEVICE mode; fallback handles the rest. */
    });

    const result = await model.generateContent(PROMPT_TEMPLATE(input));
    const response = result.response;
    const elapsed = Math.round(performance.now() - started);

    // inferenceSource is 'ON_DEVICE' or 'IN_CLOUD' (SDK v12.5.0+).
    const source = response.inferenceSource || 'UNKNOWN';
    els.source.textContent = source;
    els.badge.textContent = source === 'ON_DEVICE' ? 'on-device' : 'in cloud';
    els.badge.className = `badge ${source === 'ON_DEVICE' ? 'device' : 'cloud'}`;
    els.meta.textContent = `${modeKey} · ${elapsed} ms`;
    els.output.textContent = response.text();
    els.result.hidden = false;
  } catch (err) {
    els.errorOutput.textContent = String(err?.message || err);
    els.error.hidden = false;
    els.badge.className = 'badge unknown';
    els.badge.textContent = 'failed';
    els.source.textContent = 'error';
  } finally {
    els.run.disabled = false;
    els.run.textContent = 'Summarise';
  }
});
