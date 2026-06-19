// Simple passthrough - returns a basic response to prevent 404
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }
  return res.status(200).json({ 
    message: 'Image processing moved to client-side. The frontend now handles all processing in-browser using Canvas API.'
  });
}
