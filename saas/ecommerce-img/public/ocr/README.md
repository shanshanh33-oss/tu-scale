# TU Scale local OCR assets

These files are bundled so PDF and image OCR can run locally in the browser without fetching a model or WebAssembly runtime from a CDN.

- `tesseract-core-*-lstm.wasm.js`: Tesseract.js Core 7.0.0, Apache-2.0
- `chi_sim.traineddata.gz`: Simplified Chinese model from `@tesseract.js-data/chi_sim` 1.0.0, MIT
- `eng.traineddata.gz`: English model from `@tesseract.js-data/eng` 1.0.0, MIT

The runtime and model source packages are declared in `package.json` so these copied public assets can be reproduced during development.
