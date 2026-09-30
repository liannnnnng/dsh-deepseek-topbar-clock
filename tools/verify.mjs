/**
 * 安装后冒烟验证（DSH 桌面端）
 * ---------------------------------------------------------------
 * 用法：
 *   node tools/verify.mjs
 *   node tools/verify.mjs --port 19387
 *
 * 检查项：
 *   1. 桌面端 GUI 是否在监听
 *   2. GET /api/deepseek-balance → 宿主半已激活，且能取到真实余额
 *
 * 客户端挂件是否渲染要在界面里确认：会话标题栏右侧应出现
 * 「● 周X HH:MM:SS 空闲·半价 / 高峰 ×2」与「余额 ¥…」。
 * （桌面端前端走 dsh-app:// 自有载体，客户端 bundle 由 fetchBundle() 分发，
 *  不经过 HTTP，因此这里不探测 /plugins 路径。）
 *
 * 退出码 0 = 通过；1 = 有失败项；2 = GUI 没在监听。
 */
import { argValue } from './paths.mjs'

const PORT = Number(argValue('--port') ?? 19387)
const BASE = `http://127.0.0.1:${PORT}`

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

// 1) 桌面端 GUI 在不在
const favicon = await probe('/favicon.svg')
if (favicon.status !== 200) {
  record('DSH 桌面端 GUI 正在监听', false, favicon.error || `GET /favicon.svg → ${favicon.status}`)
  console.log('\n桌面端没在监听，请先启动 DSH 桌面端。')
  process.exit(2)
}
record('DSH 桌面端 GUI 正在监听', true, 'GET /favicon.svg → 200')

// 2) 宿主接口
const api = await probe('/api/deepseek-balance')
if (api.status === 401) {
  record('GET /api/deepseek-balance', true, '401 = 仅浏览器 Cookie 放行（接口已注册，宿主半已激活）')
} else if (api.status === 200) {
  let body = null
  try { body = JSON.parse(api.text) } catch { /* 忽略非 JSON 响应 */ }
  const info = body?.balance_infos?.[0]
  const detail = body?.ok
    ? `ok:true，余额 ${info?.total_balance} ${info?.currency ?? ''}（Key 来源：${body.keySource ?? '?'}）`
    : `ok:false：${String(body?.error ?? api.text).slice(0, 160)}`
  record('GET /api/deepseek-balance', body?.ok === true, detail)
} else {
  record('GET /api/deepseek-balance', false, `HTTP ${api.status}（404 = 插件行没生效）`)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`)
if (failed.length) {
  console.log('失败项：' + failed.map((f) => f.name).join('、'))
  console.log('排查：确认桌面端 profile 的 dsh.profile.bundles 里已选中本插件，且包可解析。')
  process.exit(1)
}
console.log('通过。客户端渲染请目视确认：会话标题栏右侧应有北京时间时钟与「余额 ¥…」。')
