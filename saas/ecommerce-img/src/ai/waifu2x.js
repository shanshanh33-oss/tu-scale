// waifu2x AI 放大模块
const MODEL_PATH = '/models/waifu2x.onnx';
const SERVER_URL = 'http://localhost:5179';
let session = null;
let useLocalModel = null;
let loadingPromise = null;
let modelStatus = 'unloaded';

export async function loadModel() {
  if (session || modelStatus === 'server') return true;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async function() {
    modelStatus = 'loading';

    // 先试本地服务（开发环境效果最好）
    try {
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
        var ort = await import('onnxruntime-web/wasm');
        var buf = await res.arrayBuffer();
        session = await ort.InferenceSession.create(buf);
        useLocalModel = true;
        modelStatus = 'loaded';
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

export async function upscaleWithAI(imageData, scale) {
  if (useLocalModel === null && !session) await loadModel();
  if (useLocalModel === false) return runServer(imageData, scale);
  if (session) return runLocal(imageData);
  throw new Error('AI model not available');
}

async function runLocal(imageData) {
  var { data, width, height } = imageData;
  var inLen = 3 * height * width;
  var inputData = new Float32Array(inLen);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      var si = (y * width + x) * 4;
      var yv = (0.299 * data[si] + 0.587 * data[si + 1] + 0.114 * data[si + 2]) / 255;
      for (let c = 0; c < 3; c++)
        inputData[c * height * width + y * width + x] = yv;
    }
  var ort = await import('onnxruntime-web/wasm');
  var t = new ort.Tensor('float32', inputData, [1, 3, height, width]);
  var inputName = session.inputNames?.[0] || 'Input1';
  var outputName = session.outputNames?.[0] || 'output';
  var r = await session.run({ [inputName]: t });
  var o = r[outputName] || Object.values(r)[0]; var oh = o.dims[2], ow = o.dims[3];
  var base = upscaleImageData(imageData, ow, oh);
  var out = new Uint8ClampedArray(oh * ow * 4);
  for (let y = 0; y < oh; y++)
    for (let x = 0; x < ow; x++) {
      var di = (y * ow + x) * 4;
      var aiR = tensorByte(o.data[0 * oh * ow + y * ow + x]);
      var aiG = tensorByte(o.data[1 * oh * ow + y * ow + x]);
      var aiB = tensorByte(o.data[2 * oh * ow + y * ow + x]);
      var aiY = 0.299 * aiR + 0.587 * aiG + 0.114 * aiB;
      var baseR = base.data[di], baseG = base.data[di + 1], baseB = base.data[di + 2];
      var baseY = Math.max(1, 0.299 * baseR + 0.587 * baseG + 0.114 * baseB);
      var targetY = baseY + (aiY - baseY) * 0.65;
      var ratio = Math.max(0.65, Math.min(1.45, targetY / baseY));
      out[di] = clampByte(baseR * ratio);
      out[di + 1] = clampByte(baseG * ratio);
      out[di + 2] = clampByte(baseB * ratio);
      out[di + 3] = base.data[di + 3];
    }
  return new ImageData(out, ow, oh);
}

function tensorByte(value) {
  return clampByte(value * 255);
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function upscaleImageData(imageData, width, height) {
  var src = document.createElement('canvas');
  src.width = imageData.width;
  src.height = imageData.height;
  src.getContext('2d').putImageData(imageData, 0, 0);
  var dst = document.createElement('canvas');
  dst.width = width;
  dst.height = height;
  var ctx = dst.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
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
