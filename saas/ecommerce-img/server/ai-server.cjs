const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.TUSCALE_AI_PORT || 5179);
const WAIFU2X_PATH = __dirname + "/../waifu2x/waifu2x-ncnn-vulkan";
const MODEL_PATH = __dirname + "/../waifu2x/models-upconv_7_photo";
const SCUNET_SCRIPT = path.join(__dirname, 'scunet-denoise.py');
const SCUNET_MODEL = path.join(__dirname, '../waifu2x/models-scunet/scunet_color_real_psnr.onnx');
const DRUNET_SCRIPT = path.join(__dirname, 'drunet-denoise.py');
const DRUNET_MODEL = path.join(__dirname, '../waifu2x/models-drunet/drunet_color.onnx');
const MAX_BODY_BYTES = 120 * 1024 * 1024;
const ALLOWED_ORIGINS = new Set([
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://localhost:5173',
  'http://localhost:5174',
]);

function findPython() {
  const candidates = [
    process.env.TUSCALE_PYTHON,
    '/Library/Frameworks/Python.framework/Versions/3.12/bin/python3',
    '/opt/homebrew/bin/python3',
    '/usr/local/bin/python3',
    '/usr/bin/python3',
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate)) || 'python3';
}

const PYTHON_PATH = findPython();

const DENOISE_BACKENDS = {
  scunet: {
    label: 'SCUNet',
    script: SCUNET_SCRIPT,
    model: SCUNET_MODEL,
    backend: 'scunet-proxy',
  },
  drunet: {
    label: 'DRUNet',
    script: DRUNET_SCRIPT,
    model: DRUNET_MODEL,
    backend: 'drunet-proxy',
  },
};

function getDenoiseAvailability() {
  return Object.fromEntries(Object.entries(DENOISE_BACKENDS).map(([key, config]) => [
    key,
    fs.existsSync(config.script) && fs.existsSync(config.model),
  ]));
}

function getUpscaleAvailability() {
  return fs.existsSync(WAIFU2X_PATH)
    && fs.existsSync(path.join(MODEL_PATH, 'scale2.0x_model.param'))
    && fs.existsSync(path.join(MODEL_PATH, 'scale2.0x_model.bin'));
}

function processImage(imageBase64, scale) {
  return new Promise((resolve, reject) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'w2x-'));
    const inputPath = path.join(tmpDir, 'input.png');
    const outputPath = path.join(tmpDir, 'output.png');
    const cleanup = () => {
      try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
    };
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    
    try {
      const buf = Buffer.from(imageBase64, 'base64');
      fs.writeFileSync(inputPath, buf);
      
      const proc = spawn(WAIFU2X_PATH, [
        '-i', inputPath,
        '-o', outputPath,
        '-m', MODEL_PATH,
        '-s', String(scale || 2),
        '-n', '-1',
        '-t', '0'
      ]);
      
      let stderr = '';
      proc.stderr.on('data', d => stderr += d.toString());
      proc.on('error', fail);
      
      proc.on('close', (code) => {
        if (settled) return;
        if (code !== 0 || !fs.existsSync(outputPath)) {
          fail(new Error(`waifu2x failed (${code}): ${stderr.slice(0,200)}`));
          return;
        }
        try {
          const outBuf = fs.readFileSync(outputPath);
          const resultBase64 = outBuf.toString('base64');
          settled = true;
          cleanup();
          resolve(resultBase64);
        } catch (error) {
          fail(error);
        }
      });
    } catch(e) {
      fail(e);
    }
  });
}

function processDenoise(imageBase64, strength, requestedBackend, clarity) {
  return new Promise((resolve, reject) => {
    const backendKey = requestedBackend === 'drunet' ? 'drunet' : 'scunet';
    const config = DENOISE_BACKENDS[backendKey];
    if (!fs.existsSync(config.script) || !fs.existsSync(config.model)) {
      reject(new Error(`${config.label} 本地降噪模型尚未安装`));
      return;
    }
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `${backendKey}-`));
    const inputPath = path.join(tmpDir, 'input.png');
    const outputPath = path.join(tmpDir, 'output.png');
    const cleanup = () => {
      try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
    };

    try {
      fs.writeFileSync(inputPath, Buffer.from(imageBase64, 'base64'));
      const proc = spawn(PYTHON_PATH, [
        config.script,
        inputPath,
        outputPath,
        '--model', config.model,
        '--strength', String(Math.max(0.35, Math.min(1, Number(strength) || 0.75))),
        '--clarity', String(Math.max(0, Math.min(1, Number(clarity) || 0))),
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      const timeout = setTimeout(() => proc.kill('SIGTERM'), 300_000);
      proc.stderr.on('data', data => { stderr += data.toString(); });
      proc.on('error', error => {
        clearTimeout(timeout);
        cleanup();
        reject(error);
      });
      proc.on('close', code => {
        clearTimeout(timeout);
        if (code !== 0 || !fs.existsSync(outputPath)) {
          cleanup();
          reject(new Error(`${config.label} failed (${code}): ${stderr.slice(0, 300)}`));
          return;
        }
        const result = fs.readFileSync(outputPath).toString('base64');
        cleanup();
        resolve({ image: result, backend: config.backend });
      });
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

function setCors(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const server = http.createServer(async (req, res) => {
  setCors(req, res);
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'ORIGIN_NOT_ALLOWED' }));
    return;
  }
  
  if (req.method === 'OPTIONS') {
    const available = getDenoiseAvailability();
    if (req.url === '/process' && !getUpscaleAvailability()) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '本地 AI 放大模型尚未安装' }));
      return;
    }
    if (req.url === '/denoise' && !available.scunet && !available.drunet) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '高质量本地降噪模型尚未安装' }));
      return;
    }
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      upscale: getUpscaleAvailability(),
      denoise: getDenoiseAvailability(),
    }));
    return;
  }

  if (req.method === 'GET' && req.url === '/denoise/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ models: getDenoiseAvailability() }));
    return;
  }
  
  if (req.method !== 'POST' || (req.url !== '/process' && req.url !== '/denoise')) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  
  let body = '';
  let bodyBytes = 0;
  let tooLarge = false;
  req.on('data', chunk => {
    bodyBytes += chunk.length;
    if (bodyBytes > MAX_BODY_BYTES) {
      tooLarge = true;
      return;
    }
    body += chunk;
  });
  req.on('end', async () => {
    try {
      if (tooLarge) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '图片数据过大，请降低输入尺寸' }));
        return;
      }
      const { image, scale, strength, backend, clarity } = JSON.parse(body);
      if (!image) throw new Error('No image data');
      const denoiseResult = req.url === '/denoise'
        ? await processDenoise(image, strength, backend, clarity)
        : null;
      const result = denoiseResult ? denoiseResult.image : await processImage(image, scale);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        image: result,
        backend: denoiseResult?.backend || 'waifu2x',
      }));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Waifu2x server running on http://localhost:${PORT}`);
  console.log(`Model: ${MODEL_PATH}`);
});
