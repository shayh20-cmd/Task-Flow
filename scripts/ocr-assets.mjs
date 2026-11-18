// On-device text recognition (Tesseract, LSTM engine) — files served under /ocr in the web app
// and copied into the Android app. Taken from node_modules at build time, not committed.
export const OCR_FILES = {
  'ocr/tesseract.esm.min.js': 'node_modules/tesseract.js/dist/tesseract.esm.min.js',
  'ocr/worker.min.js': 'node_modules/tesseract.js/dist/worker.min.js',
  'ocr/core/tesseract-core-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js',
  'ocr/core/tesseract-core-simd-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'ocr/core/tesseract-core-relaxedsimd-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
  'ocr/lang/heb.traineddata.gz': 'node_modules/@tesseract.js-data/heb/4.0.0_best_int/heb.traineddata.gz',
  'ocr/lang/eng.traineddata.gz': 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
};
