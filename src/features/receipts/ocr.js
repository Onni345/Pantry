/**
 * Client-side OCR for receipt photos, via Tesseract.js (WASM, runs entirely
 * in the browser — no API key, no new account, no server).
 *
 * This exists to split "read the pixels" from "understand the receipt".
 * Asking a vision model to do both at once — as the first version of this
 * feature did — is where the accuracy problems traced back to: it was
 * simultaneously OCRing a photo and reasoning about receipt structure.
 * Tesseract does the first job here; features/receipts/receipts.js does the
 * second with regex and a lookup table. Between them, reading a receipt now
 * involves no model call and no API key at all.
 */
import { createWorker } from 'tesseract.js';

/**
 * Recognizes text in an image file. Returns the raw, unstructured OCR text —
 * whatever Tesseract could read, in receipt reading order, misreads and all;
 * extractCandidateLines (receipts.js) is what makes sense of it, not this.
 *
 * `onProgress` receives 0..1 during recognition, for a progress readout —
 * OCR on a full receipt photo can take several seconds.
 */
export async function recognizeReceiptText(file, { onProgress } = {}) {
  const worker = await createWorker('eng', 1, {
    logger: onProgress
      ? (m) => { if (m.status === 'recognizing text') onProgress(m.progress); }
      : undefined
  });

  try {
    const { data } = await worker.recognize(file);
    const text = (data.text || '').trim();
    if (!text) throw new Error('Could not read any text from that photo. Try a clearer, flatter shot.');
    return text;
  } finally {
    await worker.terminate();
  }
}
