// On-device text recognition with Tesseract (Hebrew + English, LSTM engine).
// Everything is served locally from /ocr (bundled into the Android app), so it works offline.
import { cleanOcrText } from './shared/recipe-text.js';

let workerPromise = null;
let onProgress = null;

async function getWorker() {
  workerPromise ||= (async () => {
    const { createWorker } = (await import('/ocr/tesseract.esm.min.js')).default;
    const worker = await createWorker(['heb', 'eng'], 1 /* OEM.LSTM_ONLY */, {
      workerPath: '/ocr/worker.min.js',
      corePath: '/ocr/core',
      langPath: '/ocr/lang',
      gzip: true,
      cacheMethod: 'none', // the data files are already local
      workerBlobURL: false,
      logger: (m) => onProgress?.(m),
    });
    return worker;
  })().catch((e) => {
    workerPromise = null;
    throw e;
  });
  return workerPromise;
}

/** File / Blob / URL → canvas no larger than 2200px (big phone photos are slow and not more accurate). */
async function prepare(src) {
  const blob = typeof src === 'string' ? await (await fetch(src)).blob() : src;
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, 2200 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return canvas;
}

/**
 * Read the text in one or more images.
 * @param {(File|Blob|string)[]} sources
 * @param {(fraction: number, stage: 'loading'|'reading') => void} [progress]
 */
export async function recognizeImages(sources, progress) {
  const texts = [];
  try {
    for (let i = 0; i < sources.length; i++) {
      const n = sources.length;
      onProgress = (m) => {
        if (m.status === 'recognizing text') progress?.((i + (m.progress || 0)) / n, 'reading');
        else progress?.(i / n, 'loading');
      };
      progress?.(i / n, 'loading');
      const worker = await getWorker();
      const { data } = await worker.recognize(await prepare(sources[i]));
      texts.push(data.text || '');
    }
  } finally {
    onProgress = null;
  }
  return cleanOcrText(texts.join('\n'));
}
