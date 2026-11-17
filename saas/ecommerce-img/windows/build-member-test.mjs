import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const output = join(appRoot, 'dist-member-test')
const vite = join(appRoot, 'node_modules', 'vite', 'bin', 'vite.js')
if (!existsSync(vite)) throw new Error('Run npm ci before building the member test site')

const built = spawnSync(process.execPath, [vite, 'build', '--outDir', output], {
  cwd: appRoot,
  env: { ...process.env, VITE_MEMBER_EMAIL_ONLY: '1' },
  stdio: 'inherit',
})
if (built.error) throw built.error
if (built.status !== 0) process.exit(built.status || 1)

const indexPath = join(output, 'index.html')
let html = readFileSync(indexPath, 'utf8')
html = html.replace(/^.*<link rel="canonical".*\r?\n/gm, '')
html = html.replace(/^.*<meta property="og:(url|image)".*\r?\n/gm, '')
html = html.replace('<head>', '<head>\n    <meta name="robots" content="noindex, nofollow" />')
writeFileSync(indexPath, html)
writeFileSync(join(output, 'robots.txt'), 'User-agent: *\nDisallow: /\n')
writeFileSync(join(output, '_headers'), '/*\n  X-Robots-Tag: noindex, nofollow\n')
rmSync(join(output, 'sitemap.xml'), { force: true })
console.log('Built isolated, email-only member test site in dist-member-test')
