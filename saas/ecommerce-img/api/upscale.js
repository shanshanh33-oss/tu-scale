import { Jimp } from 'jimp';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { image, scale = 2, format = 'png', enhance = true } = req.body;
    if (!image) return res.status(400).json({ error: 'No image data' });

    const buffer = Buffer.from(image, 'base64');
    const img = await Jimp.read(buffer);
    const origW = img.bitmap.width;
    const origH = img.bitmap.height;

    let newW = Math.round(origW * parseInt(scale));
    let newH = Math.round(origH * parseInt(scale));
    const MAX = 10000;
    if (newW > MAX || newH > MAX) {
      const r = Math.min(MAX / newW, MAX / newH);
      newW = Math.round(newW * r);
      newH = Math.round(newH * r);
    }

    let result = img;
    const totalScale = newW / origW;
    if (totalScale >= 2.5) {
      let cw = origW, ch = origH;
      const steps = totalScale >= 8 ? 3 : 2;
      for (let i = 0; i < steps; i++) {
        const progress = (i + 1) / steps;
        cw = Math.round(origW * Math.pow(newW / origW, progress));
        ch = Math.round(origH * Math.pow(newH / origH, progress));
        result = result.resize({ w: cw, h: ch });
      }
    } else {
      result = result.resize({ w: newW, h: newH });
    }

    if (enhance) {
      result = result.convolute([
        [0, -1, 0],
        [-1, 5, -1],
        [0, -1, 0]
      ]);
    }

    const outFormat = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
    const outBuf = await result.getBuffer(outFormat);
    const fileSize = (outBuf.length / 1024).toFixed(1) + ' KB';

    res.json({
      image: outBuf.toString('base64'),
      format: format === 'jpeg' ? 'jpeg' : format === 'webp' ? 'webp' : 'png',
      width: result.bitmap.width,
      height: result.bitmap.height,
      originalWidth: origW,
      originalHeight: origH,
      scale: result.bitmap.width / origW,
      fileSize
    });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
}
