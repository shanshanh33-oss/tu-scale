const http = require('http');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const DIST = path.join(__dirname, 'dist');
const MIME = {
  '.html': 'text/html;charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

async function multiPassUpscale(buffer, newW, newH, fitMode, outFmt, quality, enhance) {
  const meta = await sharp(buffer, { limitInputPixels: 0 }).metadata();
  const origW = meta.width;
  const origH = meta.height;
  const scaleX = newW / origW;
  const scaleY = newH / origH;
  const avgScale = Math.max(scaleX, scaleY);
  const passes = avgScale >= 8 ? 3 : avgScale >= 4 ? 2 : avgScale >= 2.5 ? 2 : 1;

  if (passes <= 1) {
    let pipeline = sharp(buffer, { limitInputPixels: 0 }).resize(newW, newH, {
      kernel: sharp.kernel.lanczos3, withoutEnlargement: false,
      fit: fitMode, background: { r: 255, g: 255, b: 255, alpha: 1 },
    });
    if (enhance) pipeline = pipeline.sharpen({ sigma: 0.8, m1: 0, m2: 3, x1: 0, y2: 8, y3: 4 });
    return await pipeline.toFormat(outFmt, outFmt === "jpeg" ? { quality } : outFmt === "webp" ? { quality } : {}).toBuffer();
  }

  let current = buffer;
  let cw = origW, ch = origH;
  for (let i = 0; i < passes; i++) {
    const progress = (i + 1) / passes;
    const stepW = Math.round(origW * Math.pow(scaleX, progress));
    const stepH = Math.round(origH * Math.pow(scaleY, progress));
    let pipeline = sharp(current, { limitInputPixels: 0 }).resize(stepW, stepH, {
      kernel: sharp.kernel.lanczos3, withoutEnlargement: false,
      fit: fitMode, background: { r: 255, g: 255, b: 255, alpha: 1 },
    });
    if (enhance || i > 0) {
      const ss = Math.max(0.3, 0.8 - i * 0.25);
      pipeline = pipeline.sharpen({ sigma: ss, m1: 0, m2: 3, x1: 0, y2: enhance ? 8 : 4, y3: enhance ? 4 : 2 });
    }
    current = await pipeline.toBuffer();
    cw = stepW; ch = stepH;
  }
  return await sharp(current, { limitInputPixels: 0 }).toFormat(outFmt, outFmt === "jpeg" ? { quality } : outFmt === "webp" ? { quality } : {}).toBuffer();
}

async function handleAPI(body) {
  const { mode, image, format, quality, enhance, fit } = body;
  if (!image) return { status: 400, data: { error: 'No image data' } };
  const buffer = Buffer.from(image, 'base64');
  const metadata = await sharp(buffer, { limitInputPixels: 0 }).metadata();
  const outFmt = format === 'jpeg' ? 'jpeg' : format === 'webp' ? 'webp' : 'png';
  const q = parseInt(quality) || 95;

  const { scale, targetWidth, targetHeight } = body;
  let newW, newH;
  if (mode === 'target' && targetWidth && targetHeight) { newW = parseInt(targetWidth); newH = parseInt(targetHeight); }
  else { const s = parseInt(scale) || 2; newW = Math.round(metadata.width * s); newH = Math.round(metadata.height * s); }

  const MAX_DIM = 10000;
  if (newW > MAX_DIM || newH > MAX_DIM) { const r = Math.min(MAX_DIM / newW, MAX_DIM / newH); newW = Math.round(newW * r); newH = Math.round(newH * r); }

  const fitMode = fit === 'fill' ? 'fill' : fit === 'cover' ? 'cover' : 'inside';
  const result = await multiPassUpscale(buffer, newW, newH, fitMode, outFmt, q, enhance === true);
  const resultMeta = await sharp(result, { limitInputPixels: 0 }).metadata();

  return {
    status: 200,
    data: {
      image: result.toString('base64'), format: outFmt,
      width: resultMeta.width, height: resultMeta.height,
      originalWidth: metadata.width, originalHeight: metadata.height,
      scale: resultMeta.width / metadata.width,
    },
  };
}

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/upscale') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const r = await handleAPI(JSON.parse(body));
        res.writeHead(r.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r.data));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  const urlPath = req.url === '/' ? '/index.html' : req.url;
  const filePath = path.join(DIST, urlPath);
  if (!filePath.startsWith(DIST)) { res.writeHead(403); res.end('F'); return; }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(DIST, 'index.html'), (e2, d2) => {
        if (e2) { res.writeHead(404); res.end('N'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
        res.end(d2);
      }); return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(data);
  });
}).listen(5173, '0.0.0.0', () => console.log('Server on 5173'));
