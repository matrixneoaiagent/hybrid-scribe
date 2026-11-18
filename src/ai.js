// Hybrid inference layer.
//
// One GenerativeModel per inference mode. `PREFER_ON_DEVICE` asks Chrome for a
// Gemini Nano session and transparently falls back to the cloud-hosted model
// when the device has none (or the document exceeds the ~9,216-token on-device
// window). `response.inferenceSource` reports which path actually answered.

import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from 'firebase/ai';
import { app } from './firebase.js';

const ai = getAI(app, { backend: new GoogleAIBackend() });

export const MODES = {
  PREFER_ON_DEVICE: InferenceMode.PREFER_ON_DEVICE,
  ONLY_ON_DEVICE: InferenceMode.ONLY_ON_DEVICE,
  PREFER_IN_CLOUD: InferenceMode.PREFER_IN_CLOUD,
  ONLY_IN_CLOUD: InferenceMode.ONLY_IN_CLOUD,
};

const CLOUD_MODEL = 'gemini-3.5-flash-lite';
const ON_DEVICE_TOKEN_BUDGET = 9216; // documented on-device limit

export function buildModel(mode, { temperature = 0.4 } = {}) {
  return getGenerativeModel(ai, {
    mode,
    inCloudParams: {
      model: CLOUD_MODEL,
      generationConfig: { temperature, maxOutputTokens: 700 },
    },
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
        initialPrompts: [
          {
            role: 'system',
            content: [
              {
                type: 'text',
                value:
                  'You are Hybrid Scribe, a concise research assistant. Answer only from the provided document. Never invent names, numbers or dates.',
              },
            ],
          },
        ],
      },
    },
  });
}

// Chrome requires a user gesture before a Prompt API session can be created.
// Fire-and-forget for the PREFER_* modes: the request falls back to cloud while
// the model downloads. `ONLY_ON_DEVICE` awaits instead, so failures surface.
export async function warmDeviceModel(model, onProgress) {
  if (!model.initializeDeviceModel) return;
  const p = model.initializeDeviceModel((progress) => onProgress?.(progress));
  return p;
}

async function runOnce(model, prompt, label = 'call') {
  const started = performance.now();
  const result = await model.generateContent(prompt);
  const response = result.response;
  const latencyMs = Math.round(performance.now() - started);
  // The SDK reports 'on_device' | 'in_cloud' (lowercase); normalise for the UI.
  const source = String(response.inferenceSource || 'UNKNOWN').toUpperCase();
  const text = response.text().trim();
  console.debug(`[ai] ${label}: ${source} in ${latencyMs}ms (${text.length} chars)`);
  return { text, source, latencyMs };
}

// ── chunking ───────────────────────────────────────────────────────────────
// Character-based on purpose: token counts differ between on-device and cloud
// models, and countTokens() is not supported by hybrid inference.
export function chunkDocument(text, chunkSize) {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (clean.length <= chunkSize) return [clean];

  const paragraphs = clean.split(/\n{2,}/);
  const chunks = [];
  let current = '';

  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const para of paragraphs) {
    if (para.length > chunkSize) {
      // Split an oversized paragraph on sentence boundaries, then hard-split.
      const sentences = para.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) || [para];
      for (const sentence of sentences) {
        if ((current + sentence).length > chunkSize) push();
        if (sentence.length > chunkSize) {
          for (let i = 0; i < sentence.length; i += chunkSize) {
            chunks.push(sentence.slice(i, i + chunkSize).trim());
          }
        } else {
          current += sentence;
        }
      }
      continue;
    }
    if ((current + '\n\n' + para).length > chunkSize) push();
    current += (current ? '\n\n' : '') + para;
  }
  push();
  return chunks.filter(Boolean);
}

// Cheap lexical ranking for question grounding — no embeddings, no extra cost.
const STOPWORDS = new Set(
  'the a an and or but of to in on for with about from by is are was were be been it its this that these those as at into than then so if not no do does did can could should would will what when where which who whom why how many much'.split(
    ' ',
  ),
);

function scoreChunk(chunk, terms) {
  const haystack = chunk.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    let idx = haystack.indexOf(term);
    while (idx !== -1) {
      score += 1;
      idx = haystack.indexOf(term, idx + term.length);
    }
  }
  return score;
}

export function selectContext(chunks, question, budget) {
  const terms = question
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));

  const ranked = chunks
    .map((chunk, index) => ({ chunk, index, score: terms.length ? scoreChunk(chunk, terms) : 0 }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const picked = [];
  let used = 0;
  for (const item of ranked) {
    if (used + item.chunk.length > budget && picked.length) break;
    picked.push(item);
    used += item.chunk.length;
    if (used >= budget) break;
  }
  picked.sort((a, b) => a.index - b.index);
  return { context: picked.map((p) => p.chunk).join('\n\n'), indices: picked.map((p) => p.index) };
}

// ── higher-level operations ────────────────────────────────────────────────
function mergeSources(sources) {
  const unique = [...new Set(sources.filter(Boolean))];
  if (unique.length === 0) return 'UNKNOWN';
  if (unique.length === 1) return unique[0];
  return 'MIXED';
}

export async function summarizeDocument({ text, mode, chunkSize, maxChunks, style = 'bullets', onProgress }) {
  const allChunks = chunkDocument(text, chunkSize);
  const truncated = allChunks.length > maxChunks;
  const chunks = allChunks.slice(0, maxChunks);
  const model = buildModel(mode, { temperature: 0.35 });

  // Kick off the device model download without blocking the first request.
  warmDeviceModel(model).catch(() => {});

  const started = performance.now();
  const calls = [];
  const chunkSummaries = [];

  for (let i = 0; i < chunks.length; i += 1) {
    onProgress?.({
      phase: 'map',
      done: i,
      total: chunks.length + (chunks.length > 1 ? 1 : 0),
      label: `Summarising part ${i + 1} of ${chunks.length}`,
    });
    const prompt =
      `Summarise this part of a document in 3-5 short ${style === 'prose' ? 'sentences' : 'bullet points'}. ` +
      `Keep every name, number, date and conclusion. Reply with the summary only.\n\n` +
      `PART ${i + 1}/${chunks.length}\n${chunks[i]}`;
    try {
      const out = await runOnce(model, prompt, `map ${i + 1}/${chunks.length}`);
      calls.push(out);
      chunkSummaries.push(out.text);
    } catch (err) {
      calls.push({ source: 'ERROR', latencyMs: 0, text: '', error: String(err?.message || err) });
      chunkSummaries.push(`(part ${i + 1} failed: ${err?.message || err})`);
    }
  }

  const failures = calls.filter((c) => c.source === 'ERROR');
  if (failures.length === calls.length) {
    const err = new Error(failures[0].error || 'All inference calls failed');
    err.code = 'hybrid/all-failed';
    throw err;
  }

  let finalText;
  if (chunks.length === 1) {
    finalText = chunkSummaries[0];
  } else {
    onProgress?.({ phase: 'reduce', done: chunks.length, total: chunks.length + 1, label: 'Merging summaries' });
    const reducePrompt =
      `Merge these partial summaries into one set of at most 8 ${style === 'prose' ? 'sentences' : 'bullet points'}. ` +
      `Remove duplicates, keep all names, numbers and dates, and note any disagreement between parts. ` +
      `Reply with the merged summary only.\n\n${chunkSummaries
        .map((s, i) => `PART ${i + 1}:\n${s}`)
        .join('\n\n')}`;
    try {
      const reduced = await runOnce(model, reducePrompt, 'reduce');
      calls.push(reduced);
      finalText = reduced.text;
    } catch (err) {
      finalText = chunkSummaries.join('\n\n');
    }
  }

  const totalLatency = Math.round(performance.now() - started);
  return {
    summary: finalText,
    source: mergeSources(calls.map((c) => c.source)),
    perCall: calls.map((c) => ({ source: c.source, latencyMs: c.latencyMs })),
    latencyMs: totalLatency,
    chunks: chunks.length,
    totalChunks: allChunks.length,
    truncated,
    requestedMode: mode,
  };
}

export async function askQuestion({ text, question, mode, chunkSize, maxChunks, contextChars, onProgress }) {
  const allChunks = chunkDocument(text, chunkSize);
  const chunks = allChunks.slice(0, Math.max(maxChunks, 4));
  const { context, indices } = selectContext(chunks, question, contextChars);
  const model = buildModel(mode, { temperature: 0.2 });
  warmDeviceModel(model).catch(() => {});
  onProgress?.({ phase: 'ask', done: 0, total: 1, label: 'Answering from the document' });

  const prompt =
    `Answer the question using only the document excerpts below. ` +
    `If the answer is not in them, say "The document does not say." ` +
    `Quote numbers and names exactly and keep the answer under 120 words.\n\n` +
    `QUESTION: ${question}\n\nEXCERPTS:\n${context}`;

  const out = await runOnce(model, prompt, 'ask');
  return { ...out, usedChunks: indices };
}

export { ON_DEVICE_TOKEN_BUDGET, CLOUD_MODEL };
