import { mkdir, open, readFile, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { spawn } from 'node:child_process'

const [url, outputPath, sizeValue, partCountValue = '8'] = process.argv.slice(2)
const totalSize = Number(sizeValue)
const partCount = Math.max(1, Number(partCountValue) || 8)

if (!url || !outputPath || !Number.isSafeInteger(totalSize) || totalSize <= 0) {
  console.error('Usage: node download-ranged.mjs URL OUTPUT_PATH TOTAL_BYTES [PART_COUNT]')
  process.exit(2)
}

await mkdir(dirname(outputPath), { recursive: true })

function runCurl(start, end, partPath) {
  return new Promise((resolve, reject) => {
    const child = spawn('curl', [
      '-4',
      '-fL',
      '--silent',
      '--show-error',
      '--http1.1',
      '--connect-timeout', '20',
      '--max-time', '180',
      '--retry', '3',
      '--retry-all-errors',
      '--range', `${start}-${end}`,
      url,
      '-o', partPath,
    ], { stdio: ['ignore', 'inherit', 'inherit'] })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`curl range ${start}-${end} failed with exit code ${code}`))
    })
  })
}

const ranges = Array.from({ length: partCount }, (_, index) => {
  const start = Math.floor(totalSize * index / partCount)
  const end = Math.floor(totalSize * (index + 1) / partCount) - 1
  return { start, end, path: `${outputPath}.part-${String(index).padStart(2, '0')}` }
})

try {
  await Promise.all(ranges.map(async range => {
    let valid = false
    try {
      const info = await stat(range.path)
      valid = info.size === range.end - range.start + 1
    } catch {
      // Missing or partial fragment is downloaded below.
    }
    if (!valid) {
      await rm(range.path, { force: true })
      await runCurl(range.start, range.end, range.path)
    }
    const info = await stat(range.path)
    const expected = range.end - range.start + 1
    if (info.size !== expected) {
      throw new Error(`Range ${range.start}-${range.end} has ${info.size} bytes; expected ${expected}`)
    }
  }))

  await rm(outputPath, { force: true })
  const destination = await open(outputPath, 'w')
  try {
    for (const range of ranges) {
      await destination.write(await readFile(range.path))
    }
  } finally {
    await destination.close()
  }

  const result = await stat(outputPath)
  if (result.size !== totalSize) {
    throw new Error(`Combined download has ${result.size} bytes; expected ${totalSize}`)
  }
} finally {
  await Promise.all(ranges.map(range => rm(range.path, { force: true })))
}
