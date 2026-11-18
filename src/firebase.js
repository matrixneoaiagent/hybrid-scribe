// Firebase bootstrap for Hybrid Scribe.
//
// Services wired here, all actually used at runtime:
//   • App Check      — debug token locally / registered token on the live site
//   • Authentication — anonymous session (private Firestore namespace, no signup)
//   • Cloud Firestore— persisted notes + summaries, IndexedDB cache for offline reads
//   • Remote Config  — chunk size, chunk cap, hybrid policy, QA context budget
//   • AI Logic       — see src/ai.js

import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
} from 'firebase/firestore';
import { getRemoteConfig, fetchAndActivate, getValue } from 'firebase/remote-config';
import { firebaseConfig } from './firebase-config.js';

// A debug token registered for this web app in the Firebase console. It is
// injected at build time from .env.local and never committed to the repo.
const debugToken = import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN;
const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;

if (debugToken) self.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;

export const app = initializeApp(firebaseConfig);

// App Check is initialised at import time: the AI Logic service must never be
// created before an attestation provider exists, otherwise the first request
// is sent without a token.
function initAppCheck() {
  try {
    if (siteKey) {
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(siteKey),
        isTokenAutoRefreshEnabled: true,
      });
      return 'reCAPTCHA v3';
    }
    // Debug provider takes precedence over the (placeholder) provider when
    // FIREBASE_APPCHECK_DEBUG_TOKEN is set.
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider('debug-provider-placeholder'),
      isTokenAutoRefreshEnabled: true,
    });
    return debugToken ? 'debug token' : 'not configured';
  } catch (err) {
    return `error: ${err.message}`;
  }
}

export const appCheckStatus = initAppCheck();

export const auth = getAuth(app);

// Offline-first: notes stay readable from the IndexedDB cache when the network
// drops, which is the whole point of a field-research tool.
export const db = initializeFirestore(
  app,
  { localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({}) }) },
  'default', // the database created for this project (not "(default)")
);

export function signIn() {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, (user) => {
      if (user) resolve(user);
    });
    signInAnonymously(auth).catch((err) => {
      console.warn('[auth] anonymous sign-in failed', err?.code, err?.message);
    });
  });
}

// ── Remote Config ──────────────────────────────────────────────────────────
const remoteConfig = getRemoteConfig(app);
remoteConfig.settings.minimumFetchIntervalMillis = 5 * 60 * 1000;
remoteConfig.defaultConfig = {
  chunk_size: '1800',
  max_chunks: '6',
  hybrid_policy: 'prefer_on_device',
  qa_context_chars: '4000',
  summary_style: 'bullets',
};

export async function loadRemoteConfig() {
  const started = performance.now();
  let status = 'defaults';
  try {
    const activated = await fetchAndActivate(remoteConfig);
    status = activated ? 'fetched' : 'cached';
  } catch (err) {
    status = `fallback (${err?.code || 'error'})`;
  }
  const num = (key) => Number(getValue(remoteConfig, key).asNumber());
  const str = (key) => getValue(remoteConfig, key).asString();
  return {
    status,
    fetchedInMs: Math.round(performance.now() - started),
    chunkSize: Math.max(400, Math.min(12000, num('chunk_size') || 1800)),
    maxChunks: Math.max(1, Math.min(20, num('max_chunks') || 6)),
    policy: str('hybrid_policy') || 'prefer_on_device',
    qaContextChars: Math.max(800, Math.min(30000, num('qa_context_chars') || 4000)),
    summaryStyle: str('summary_style') || 'bullets',
  };
}
