// App Check initialisation.
//
// Local development and judging use the App Check debug provider: the token is
// registered for this web app in the Firebase console and supplied through
// .env.local (never committed). A public deployment should register a
// production attestation provider (reCAPTCHA/Fraud Defense) and set
// VITE_RECAPTCHA_SITE_KEY instead.

import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { firebaseConfig } from './firebase-config.js';

const debugToken = import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN;
const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;

if (debugToken) {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
}

export const app = initializeApp(firebaseConfig);

export function initAppCheck() {
  if (siteKey) {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
    return 'reCAPTCHA v3';
  }
  // Debug builds only: the SDK issues its own debug token.
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider('debug-provider-placeholder'),
    isTokenAutoRefreshEnabled: true,
  });
  return debugToken ? 'debug token' : 'no provider configured';
}
