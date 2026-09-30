/**
 * 宿主半的离线自测（不依赖真实 DSH 运行时）：
 *
 *   1) Key 查找 + 余额查询          —— 直接 import src/index.mjs
 *   2) 路由注册与 handler 行为       —— 用假的 ctx/webServer，验证
 *      - ctx.webServer.register 收到 kind/path/handler
 *      - handler 对无 query 与 ?refresh=1 的返回
 *      - ctx.effect 的清理函数会注销路由
 *
 * 用法：
 *   node test-host.mjs            只查 Key（不联网）
 *   node test-host.mjs --fetch    额外真实调用 api.deepseek.com 取一次余额
 */
import assert from 'node:assert/strict'

const mod = await import('../src/index.mjs')
const { deepSeekKey, fetchBalance, apply } = mod
if (typeof apply !== 'function') throw new Error('Host 插件必须以 export function apply(ctx) 形式导出')
if (!Array.isArray(mod.inject) || !mod.inject.includes('webServer')) throw new Error('必须导出 inject = [\'webServer\']')

// —— 1) Key 查找 ——
const found = deepSeekKey()
if (!found) {
  console.log('KEY: 未找到 DeepSeek API Key（UI 会显示「余额 —」并给出原因，属预期降级）')
} else {
  console.log(`KEY: 已找到（来源：${found.source}，长度 ${found.key.length}，前缀 ${found.key.slice(0, 6)}…）`)
}

if (process.argv.includes('--fetch')) {
  const data = await fetchBalance(true)
  console.log('BALANCE: ' + JSON.stringify(data, null, 2))
  const cached = await fetchBalance(false)
  console.log('CACHED: fromCache=' + cached.fromCache)
}

// —— 2) 路由注册 / handler ——
const registrations = []
let disposed = 0
const fakeCtx = {
  webServer: {
    register(route) {
      registrations.push(route)
      return () => { disposed += 1 }
    },
  },
  effect(fn) {
    // 真实 cordis：回调返回的是「卸载时执行」的 disposer，注册时不调用。
    const off = fn()
    assert.equal(typeof off, 'function', 'ctx.effect 回调应返回清理函数')
    assert.equal(disposed, 0, 'disposer 不应在注册时立即执行')
    off() // 模拟 fiber 卸载
  },
}

apply(fakeCtx)
assert.equal(registrations.length, 1, '应注册恰好 1 条路由')
assert.equal(registrations[0].kind, 'exact')
assert.equal(registrations[0].path, '/api/deepseek-balance')
assert.equal(typeof registrations[0].handler, 'function')
assert.equal(disposed, 1, 'fiber 卸载时 disposer 应注销路由')
console.log('ROUTE: kind=exact path=/api/deepseek-balance 注册 OK，清理钩子 OK')

// 跑一次 handler（不联网时 key 缺失/网络失败都会返回结构化 JSON，不会抛）
function callHandler(url) {
  return new Promise((resolve) => {
    const chunks = []
    const res = {
      statusCode: 0,
      headers: null,
      writeHead(code, headers) { this.statusCode = code; this.headers = headers },
      end(body) { chunks.push(body); resolve({ status: this.statusCode, headers: this.headers, body: JSON.parse(chunks.join('')) }) },
    }
    registrations[0].handler({ url, method: 'GET' }, res)
  })
}

const plain = await callHandler('/api/deepseek-balance')
assert.equal(plain.status, 200)
assert.equal(typeof plain.body.ok, 'boolean')
assert.equal(plain.headers['Cache-Control'], 'no-store')
console.log('HANDLER: 无 query → 200，ok=' + plain.body.ok + (plain.body.ok ? `，余额 ${plain.body.balance_infos?.[0]?.total_balance} ${plain.body.balance_infos?.[0]?.currency}` : `，原因：${plain.body.error}`))

const forced = await callHandler('/api/deepseek-balance?refresh=1')
assert.equal(forced.status, 200)
assert.equal(typeof forced.body.ok, 'boolean')
console.log('HANDLER: ?refresh=1 → 200，ok=' + forced.body.ok + (forced.body.ok ? '，fromCache=' + forced.body.fromCache : ''))
