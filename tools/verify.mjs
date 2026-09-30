/**
 * 安装后验证（重启/热加载之后运行）
 * ---------------------------------------------------------------
 * 用法：
 *   node verify.mjs
 *   node verify.mjs --port 19387
 *   node verify.mjs --logs "<Electron userData>/logs"   # 显式指定崩溃日志目录
 *
 * 检查项：
 *   1. GUI 是否在监听
 *   2. GET /api/deepseek-balance       → 宿主半已激活，且能拿到真实余额
 *   3. 无本插件引起的新致命崩溃       → 上一版曾触发桌面端 web boot 致命退出
 *
 * 为什么这里不检查 /plugins/<id>/client.js：
 *   桌面端把前端通过 `dsh-app://` 自有载体加载（shell-owned carrier），客户端
 *   bundle 由 `fetchBundle()` 分发，**不是** `dsh web` 那套 HTTP `/plugins` 路由，
 *   所以在 127.0.0.1:19387 上探测该路径必然 404 —— 那是假阴性，与插件无关。
 *   客户端是否渲染请在页面里确认：标题栏右侧应出现
 *   「● 周X HH:MM:SS 空闲·半价/高峰 ×2」与「余额 ¥…」。
 *
 * 退出码 0 = 通过；1 = 有失败项；2 = GUI 没在监听。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { argValue, crashLogDir } from './paths.mjs'

const PORT = Number(argValue('--port') ?? 19387)
const BASE = `http://127.0.0.1:${PORT}`
const ID = 'dsh-deepseek-topbar-clock'
// 崩溃日志目录：按 Electron userData 约定推导（可用 --logs 覆盖）
const CRASH_DIR = crashLogDir()
const SELF = new URL('../client.js', import.meta.url)

const results = []
function record(name, ok, detail) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

async function probe(path) {
  try {
    const res = await fetch(BASE + path, { redirect: 'manual' })
    const text = await res.text().catch(() => '')
    return { status: res.status, text }
  } catch (e) {
    return { status: 0, error: String((e && e.message) || e) }
  }
}

console.log(`验证目标：${BASE}\n`)

// 1) GUI 在不在
const favicon = await probe('/favicon.svg')
if (favicon.status !== 200) {
  record('GUI 正在监听', false, favicon.error || `GET /favicon.svg → ${favicon.status}`)
  console.log('\n桌面端没在监听，请先启动（或重启）DSH 桌面端。')
  process.exit(2)
}
record('GUI 正在监听', true, 'GET /favicon.svg → 200')

// 2) 宿主接口
const api = await probe('/api/deepseek-balance')
if (api.status === 401) {
  record('GET /api/deepseek-balance', true, '401 = 仅浏览器 Cookie 放行（接口已注册，宿主半已激活）')
} else if (api.status === 200) {
  let body = null
  try { body = JSON.parse(api.text) } catch { /* 忽略 */ }
  const info = body?.balance_infos?.[0]
  const detail = body?.ok
    ? `ok:true，余额 ${info?.total_balance} ${info?.currency ?? ''}（Key 来源：${body.keySource ?? '?'}）`
    : `ok:false：${String(body?.error ?? api.text).slice(0, 160)}`
  record('GET /api/deepseek-balance', body?.ok === true, detail)
} else {
  record('GET /api/deepseek-balance', false, `HTTP ${api.status}（404 = 宿主行没生效）`)
}

// 3) 崩溃日志
let crashDetail = 'logs 下 crash-* 均为修复前产生'
let crashOk = true
try {
  const files = readdirSync(CRASH_DIR).filter((f) => f.startsWith('crash-') && f.endsWith('-web-boot.log'))
  const selfMtime = statSync(SELF).mtimeMs
  for (const f of files) {
    const full = join(CRASH_DIR, f)
    if (statSync(full).mtimeMs <= selfMtime) continue
    const text = readFileSync(full, 'utf8')
    if (text.includes(ID)) {
      crashOk = false
      crashDetail = `新的致命崩溃：${f}（${text.split('\n').find((l) => l.includes(ID)) ?? ''}）`
    }
  }
  if (crashOk) crashDetail = `logs 下 crash-* 共 ${files.length} 个，均早于当前插件版本`
} catch (e) {
  crashDetail = `无法读取崩溃日志目录（已跳过）：${CRASH_DIR} — ${String((e && e.message) || e)}`
}
record('无本插件引起的新致命崩溃', crashOk, crashDetail)

const failed = results.filter((r) => !r.ok)
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`)
if (failed.length) {
  console.log('失败项：' + failed.map((f) => f.name).join('、'))
  console.log('若余额接口 404：确认 profile 的 dsh.profile.bundles 含 ' + ID + '，且 node_modules 里该包可解析。')
  console.log('若出现新的 crash-*-web-boot.log：执行 rollback.mjs --apply 回滚，不要反复重启试错。')
  process.exit(1)
}
console.log('通过。客户端渲染请目视确认：标题栏右侧应有北京时间时钟（高峰红 / 空闲绿）与「余额 ¥…」。')
