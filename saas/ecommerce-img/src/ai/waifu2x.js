// waifu2x AI 放大模块
import wasmRuntimeUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';

const MODEL_PATH = '/models/waifu2x.onnx';
const SERVER_URL = 'http://localhost:5179';
const MODEL_PADDING = 7;
const LOW_MEMORY_TILE_SIZE = 160;
const MOBILE_TILE_SIZE = 192;
const DESKTOP_TILE_SIZE = 384;
let session = null;
let runtime = null;
let useLocalModel = null;
let loadingPromise = null;
let modelStatus = 'unloaded';

function isMobileDevice() {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent));
}

function isAppleMobileDevice() {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent));
}

function configureWasm(ort) {
  var deviceMemory = typeof navigator !== 'undefined' ? Number(navigator.deviceMemory) : 0;
  var hardwareThreads = typeof navigator !== 'undefined' ? Number(navigator.hardwareConcurrency) : 1;
  var canUseThreads = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
  var mobileDevice = isMobileDevice();
  var appleMobile = isAppleMobileDevice();
  var threadLimit = appleMobile
    ? 1
    : !mobileDevice && deviceMemory >= 8 && hardwareThreads >= 8
      ? 4
      : 2;
  ort.env.wasm.numThreads = canUseThreads && !(deviceMemory > 0 && deviceMemory <= 4)
    ? Math.max(1, Math.min(threadLimit, hardwareThreads || 1))
    : 1;
  // The packaged ORT proxy worker fails to initialize on some mobile Safari
  // and Android WebView versions. Small tiles plus frequent browser yields are
  // more compatible while keeping the exact same model math.
  ort.env.wasm.proxy = false;
  // Let Vite provide the actual fingerprinted asset URL instead of relying on
  // a build-specific filename that can change after dependency updates.
  ort.env.wasm.wasmPaths = { 'ort-wasm-simd-threaded.wasm': wasmRuntimeUrl };
}

async function loadWasmOrt() {
  var ort = await import('onnxruntime-web/wasm');
  configureWasm(ort);
  return ort;
}

async function createBrowserSession(buffer) {
  var deviceMemory = typeof navigator !== 'undefined' ? Number(navigator.deviceMemory) : 0;
  var lowMemoryDevice = deviceMemory > 0 && deviceMemory <= 4;
  var mobileDevice = isMobileDevice();
  var androidChrome = typeof navigator !== 'undefined'
    && /Android/i.test(navigator.userAgent)
    && /Chrome/i.test(navigator.userAgent)
    && !/EdgA|OPR/i.test(navigator.userAgent);
  var allowWebGpu = !mobileDevice || (androidChrome && deviceMemory >= 8);
  if (typeof navigator !== 'undefined' && navigator.gpu && !lowMemoryDevice && allowWebGpu) {
    try {
      var webgpuOrt = await import('onnxruntime-web/webgpu');
      webgpuOrt.env.webgpu.powerPreference = 'high-performance';
      var webgpuSession = await webgpuOrt.InferenceSession.create(buffer, {
        executionProviders: [{ name: 'webgpu', preferredLayout: 'NHWC' }],
        graphOptimizationLevel: 'all',
      });
      return { ort: webgpuOrt, session: webgpuSession, backend: 'webgpu' };
    } catch (webgpuError) {
      console.warn('WebGPU unavailable for waifu2x, falling back to WASM.', webgpuError);
    }
  }

  var wasmOrt = await loadWasmOrt();
  var wasmSession = await wasmOrt.InferenceSession.create(buffer, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  return { ort: wasmOrt, session: wasmSession, backend: 'wasm' };
}

export async function loadModel() {
  if (session || modelStatus === 'server') return true;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async function() {
    modelStatus = 'loading';

    // 先试本地服务（开发环境效果最好）
    var mobileLayout = isMobileDevice();
    try {
      if (mobileLayout) throw new Error('Skip desktop localhost probe on mobile');
      var r = await fetch(SERVER_URL + '/process', { method: 'OPTIONS', signal: AbortSignal.timeout(1500) });
      if (r.ok) {
        useLocalModel = false;
        modelStatus = 'server';
        return true;
      }
    } catch {
      // Local server is optional in production.
    }

    // 再试浏览器 ONNX 模型
    try {
      var res = await fetch(MODEL_PATH);
      if (res.ok) {
        var buf = await res.arrayBuffer();
        var browser = await createBrowserSession(buf);
        runtime = browser.ort;
        session = browser.session;
        useLocalModel = true;
        modelStatus = browser.backend;
        return true;
      }
    } catch {
      // Browser ONNX fallback may fail on unsupported runtimes or missing files.
    }

    useLocalModel = null;
    modelStatus = 'failed';
    return false;
  })().finally(function() {
    loadingPromise = null;
  });

  return loadingPromise;
}
export function isModelLoaded() { return !!session || modelStatus === 'server'; }
export function getModelStatus() { return modelStatus; }

export async function upscaleWithAI(imageData, scale = 2, options = {}) {
  if (typeof scale === 'object' && scale !== null) {
    options = scale;
    scale = 2;
  }
  if (useLocalModel === null && !session) await loadModel();
  if (useLocalModel === false) return runServer(imageData, scale);
  if (session) return runLocal(imageData, options);
  throw new Error('AI model not available');
}

// For large phone photos, run the same 2x AI model one tile at a time and
// reduce each completed tile back to its original dimensions immediately.
// This keeps AI reconstruction without ever allocating a full-size 2x image.
export async function enhanceCanvasWithAI(sourceCanvas, options = {}) {
  if (useLocalModel === null && !session) await loadModel();

  if (useLocalModel === false) {
    var sourceContext = sourceCanvas.getContext('2d');
    var sourceImage = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    var serverResult = await runServer(sourceImage, 2);
    var serverCanvas = document.createElement('canvas');
    serverCanvas.width = serverResult.width;
    serverCanvas.height = serverResult.height;
    serverCanvas.getContext('2d').putImageData(serverResult, 0, 0);
    var serverOutput = document.createElement('canvas');
    serverOutput.width = sourceCanvas.width;
    serverOutput.height = sourceCanvas.height;
    var serverOutputContext = serverOutput.getContext('2d');
    serverOutputContext.imageSmoothingEnabled = true;
    serverOutputContext.imageSmoothingQuality = 'high';
    serverOutputContext.drawImage(serverCanvas, 0, 0, serverOutput.width, serverOutput.height);
    return serverOutput;
  }

  if (!session) throw new Error('AI model not available');
  return runLocalCanvasAtOriginalSize(sourceCanvas, options);
}

function getTileSize(options = {}) {
  if (Number.isFinite(options.tileSize)) {
    return Math.max(64, Math.min(512, Math.round(options.tileSize)));
  }
  var deviceMemory = typeof navigator !== 'undefined' ? Number(navigator.deviceMemory) : 0;
  var mobileLayout = isMobileDevice();
  if (deviceMemory > 0 && deviceMemory <= 4) return LOW_MEMORY_TILE_SIZE;
  if (mobileLayout && modelStatus === 'webgpu') return 256;
  return mobileLayout ? MOBILE_TILE_SIZE : DESKTOP_TILE_SIZE;
}

export function createTilePlan(width, height, tileSize, padding = MODEL_PADDING) {
  var tiles = [];
  for (let coreY = 0; coreY < height; coreY += tileSize) {
    for (let coreX = 0; coreX < width; coreX += tileSize) {
      var coreWidth = Math.min(tileSize, width - coreX);
      var coreHeight = Math.min(tileSize, height - coreY);
      tiles.push({
        coreX,
        coreY,
        coreWidth,
        coreHeight,
        padding,
        inputWidth: coreWidth + padding * 2 + (coreWidth % 2),
        inputHeight: coreHeight + padding * 2 + (coreHeight % 2),
      });
    }
  }
  return tiles;
}

function yieldToBrowser() {
  return new Promise(function(resolve) {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function() { resolve(); });
    else setTimeout(resolve, 0);
  });
}

async function runLocal(imageData, options = {}) {
  var tileSize = getTileSize(options);
  var tiles = createTilePlan(imageData.width, imageData.height, tileSize);
  var ort = runtime || await loadWasmOrt();
  var outputWidth = imageData.width * 2;
  var outputHeight = imageData.height * 2;
  var outputData = new Uint8ClampedArray(outputWidth * outputHeight * 4);
  var deviceMemory = typeof navigator !== 'undefined' ? Number(navigator.deviceMemory) : 0;
  var mobileDevice = isMobileDevice();
  var inputBuffers = new Map();
  var yieldEvery = deviceMemory > 0 && deviceMemory <= 4
    ? 1
    : mobileDevice
      ? modelStatus === 'webgpu' ? 4 : 1
      : 4;
  var opaque = true;
  for (let alphaIndex = 3; alphaIndex < imageData.data.length; alphaIndex += 4) {
    if (imageData.data[alphaIndex] !== 255) {
      opaque = false;
      break;
    }
  }

  for (let index = 0; index < tiles.length; index++) {
    var tile = tiles[index];
    var tileResult = await runLocalTile(imageData, tile, ort, inputBuffers);
    copyModelTile(tileResult, imageData, outputData, outputWidth, tile, opaque);
    tileResult.dispose?.();
    options.onProgress?.({ completed: index + 1, total: tiles.length });
    if ((index + 1) % yieldEvery === 0 || index === tiles.length - 1) await yieldToBrowser();
  }

  return new ImageData(outputData, outputWidth, outputHeight);
}

async function runLocalCanvasAtOriginalSize(sourceCanvas, options = {}) {
  var tileSize = getTileSize(options);
  var tiles = createTilePlan(sourceCanvas.width, sourceCanvas.height, tileSize);
  var ort = runtime || await loadWasmOrt();
  var sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
  var outputCanvas = document.createElement('canvas');
  outputCanvas.width = sourceCanvas.width;
  outputCanvas.height = sourceCanvas.height;
  var outputContext = outputCanvas.getContext('2d');
  var inputBuffers = new Map();

  for (let index = 0; index < tiles.length; index++) {
    var tile = tiles[index];
    var extraRight = tile.coreWidth % 2;
    var extraBottom = tile.coreHeight % 2;
    var inputX = Math.max(0, tile.coreX - tile.padding);
    var inputY = Math.max(0, tile.coreY - tile.padding);
    var inputRight = Math.min(
      sourceCanvas.width,
      tile.coreX + tile.coreWidth + tile.padding + extraRight,
    );
    var inputBottom = Math.min(
      sourceCanvas.height,
      tile.coreY + tile.coreHeight + tile.padding + extraBottom,
    );
    var localImage = sourceContext.getImageData(
      inputX,
      inputY,
      inputRight - inputX,
      inputBottom - inputY,
    );
    var localTile = {
      ...tile,
      coreX: tile.coreX - inputX,
      coreY: tile.coreY - inputY,
    };
    var tileResult = await runLocalTile(localImage, localTile, ort, inputBuffers);
    var originalSizeTile = createOriginalSizeTile(tileResult, localImage, localTile);
    outputContext.putImageData(originalSizeTile, tile.coreX, tile.coreY);
    tileResult.dispose?.();
    options.onProgress?.({ completed: index + 1, total: tiles.length });
    await yieldToBrowser();
  }

  return outputCanvas;
}

async function runLocalTile(imageData, tile, ort, inputBuffers) {
  var { data } = imageData;
  var width = tile.inputWidth;
  var height = tile.inputHeight;
  var planeSize = height * width;
  var inLen = 3 * planeSize;
  var bufferKey = width + 'x' + height;
  var inputData = inputBuffers?.get(bufferKey);
  if (!inputData) {
    inputData = new Float32Array(inLen);
    inputBuffers?.set(bufferKey, inputData);
  }
  var inverse255 = 1 / 255;
  for (let y = 0; y < height; y++) {
    var sourceY = tile.coreY - tile.padding + y;
    if (sourceY < 0) sourceY = 0;
    else if (sourceY >= imageData.height) sourceY = imageData.height - 1;
    for (let x = 0; x < width; x++) {
      var sourceX = tile.coreX - tile.padding + x;
      if (sourceX < 0) sourceX = 0;
      else if (sourceX >= imageData.width) sourceX = imageData.width - 1;
      var si = (sourceY * imageData.width + sourceX) * 4;
      var pixel = y * width + x;
      inputData[pixel] = data[si] * inverse255;
      inputData[planeSize + pixel] = data[si + 1] * inverse255;
      inputData[planeSize * 2 + pixel] = data[si + 2] * inverse255;
    }
  }
  var t = new ort.Tensor('float32', inputData, [1, 3, height, width]);
  var inputName = session.inputNames?.[0] || 'Input1';
  var outputName = session.outputNames?.[0] || 'output';
  var r = await session.run({ [inputName]: t });
  return r[outputName] || Object.values(r)[0];
}

function modelByte(value) {
  var scaled = value * 255;
  return scaled <= 0 ? 0 : scaled >= 255 ? 255 : Math.round(scaled);
}

function copyModelTile(modelOutput, imageData, outputData, outputWidth, tile, opaque) {
  var modelWidth = modelOutput.dims[3];
  var modelPixels = modelOutput.dims[2] * modelWidth;
  var copyWidth = tile.coreWidth * 2;
  var copyHeight = tile.coreHeight * 2;
  for (let y = 0; y < copyHeight; y++) {
    var modelRow = y * modelWidth;
    var destination = ((tile.coreY * 2 + y) * outputWidth + tile.coreX * 2) * 4;
    var sourceY = tile.coreY + (y >> 1);
    for (let x = 0; x < copyWidth; x++) {
      var modelPixel = modelRow + x;
      outputData[destination] = modelByte(modelOutput.data[modelPixel]);
      outputData[destination + 1] = modelByte(modelOutput.data[modelPixels + modelPixel]);
      outputData[destination + 2] = modelByte(modelOutput.data[modelPixels * 2 + modelPixel]);
      outputData[destination + 3] = opaque
        ? 255
        : imageData.data[(sourceY * imageData.width + tile.coreX + (x >> 1)) * 4 + 3];
      destination += 4;
    }
  }
}

function createOriginalSizeTile(modelOutput, sourceImage, tile) {
  var modelWidth = modelOutput.dims[3];
  var modelPixels = modelOutput.dims[2] * modelWidth;
  var output = new Uint8ClampedArray(tile.coreWidth * tile.coreHeight * 4);
  for (let y = 0; y < tile.coreHeight; y++) {
    var topRow = y * 2 * modelWidth;
    var bottomRow = topRow + modelWidth;
    for (let x = 0; x < tile.coreWidth; x++) {
      var topLeft = topRow + x * 2;
      var bottomLeft = bottomRow + x * 2;
      var destination = (y * tile.coreWidth + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        var plane = channel * modelPixels;
        var average = (
          modelOutput.data[plane + topLeft]
          + modelOutput.data[plane + topLeft + 1]
          + modelOutput.data[plane + bottomLeft]
          + modelOutput.data[plane + bottomLeft + 1]
        ) * 0.25;
        output[destination + channel] = modelByte(average);
      }
      var sourcePixel = (
        (tile.coreY + y) * sourceImage.width
        + tile.coreX
        + x
      ) * 4;
      output[destination + 3] = sourceImage.data[sourcePixel + 3];
    }
  }
  return new ImageData(output, tile.coreWidth, tile.coreHeight);
}
async function runServer(imageData, scale) {
  var c = document.createElement('canvas');
  c.width = imageData.width; c.height = imageData.height;
  c.getContext('2d').putImageData(imageData, 0, 0);
  var b64 = c.toDataURL('image/png').split(',')[1];
  var res = await fetch(SERVER_URL + '/process', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: b64, scale })
  });
  if (!res.ok) throw new Error('Server error');
  var d = await res.json();
  var img = new Image();
  await new Promise(function(rs, rj) { img.onload = rs; img.onerror = rj; img.src = 'data:image/png;base64,' + d.image; });
  var oc = document.createElement('canvas');
  oc.width = img.width; oc.height = img.height;
  oc.getContext('2d').drawImage(img, 0, 0);
  return oc.getContext('2d').getImageData(0, 0, img.width, img.height);
}
export { upscaleWithAI as processWithAI };
