// 轻量统计 API - 纯内存计数，无需外部存储
// 注意：Serverless 冷启动时数据会重置，对个人工具影响很小

let stats = {
  total: 0,
  daily: {},
  lastTime: null
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    return res.status(200).end()
  }
  res.setHeader('Access-Control-Allow-Origin', '*')

  const today = new Date().toISOString().slice(0, 10)

  if (req.method === 'POST') {
    stats.total++
    stats.daily[today] = (stats.daily[today] || 0) + 1
    stats.lastTime = Date.now()
    return res.status(200).json({
      ok: true,
      total: stats.total,
      daily: stats.daily[today],
      date: today
    })
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      totalCount: stats.total,
      todayCount: stats.daily[today] || 0,
      todayDate: today,
      lastTimestamp: stats.lastTime
    })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
