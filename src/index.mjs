/**
 * dsh-deepseek-topbar-clock — Host 半（node 侧）
 * ---------------------------------------------------------------------------
 * 给 DSH 桌面端 / web 端新增一个只读接口：
 *
 *   GET /api/deepseek-balance           → 命中 60 秒内存缓存
 *   GET /api/deepseek-balance?refresh=1 → 强制刷新
 *
 * 返回结构化 JSON：
 *   { ok:true, fetchedAt, fromCache, keySource, is_available, balance_infos }
 *   { ok:false, fetchedAt, error, http? }
 *
 * 导出形式遵循官方规范（cordis-plugin-development/references/host-plugin.md）：
 *   export function apply(ctx, config) {}
 *   export const inject = ['webServer']
 * 不能用 `export default { inject, apply }` —— 带 inject 的非函数声明会被 Cordis
 * 判定为插件激活失败，桌面端把「web boot entry 未激活」当致命错误（崩溃日志实证）。
 *
 * 为什么要走宿主：DeepSeek API Key 只存在宿主侧（环境变量 / 凭据文件），不能下发到浏览器；
 * 且 api.deepseek.com 不返回 CORS 头，浏览器无法直接跨域请求。
 *
 * Key 查找顺序：
 *   1. 环境变量 DEEPSEEK_API_KEY
 *   2. 本插件配置 ${DSH_HOME}/dsh-deepseek-topbar-clock/config.json 的 deepseekApiKey
 *   3. ${DSH_HOME}/.credentials.yaml 的 DEEPSEEK_API_KEY（DSH 登录态自动带出）
 *
 * 浏览器半在 client.js（`dsh.client` 声明的 `./client`）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const NAME = 'dsh-deepseek-topbar-clock'
const ROUTE_PATH = '/api/deepseek-balance'
const BALANCE_URL = 'https://api.deepseek.com/user/balance'
const CACHE_MS = 60_000
const TIMEOUT_MS = 10_000

/** 插件行依赖的宿主服务：webServer 提供 ctx.webServer.register(route)。 */
export const inject = ['webServer']

/** @type {{ ts: number, payload: unknown }} */
let cache = { ts: 0, payload: null }

function dshHome() {
  if (process.env.DSH_HOME) return String(process.env.DSH_HOME).replace(/[\\/]+$/, '')
  if (process.env.HOME) return join(process.env.HOME, '.dsh')
  return join(homedir(), '.dsh')
}

function readJson(file) {
  try {
    if (!existsSync(file)) return null
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** 读取 DeepSeek API Key；找不到返回 null（不回显、不落盘）。 */
export function deepSeekKey() {
  const env = process.env.DEEPSEEK_API_KEY
  if (env && String(env).trim()) return { key: String(env).trim(), source: '环境变量 DEEPSEEK_API_KEY' }

  const home = dshHome()

  const own = readJson(join(home, NAME, 'config.json'))
  if (own && typeof own.deepseekApiKey === 'string' && own.deepseekApiKey.trim()) {
    return { key: own.deepseekApiKey.trim(), source: `${NAME}/config.json` }
  }

  try {
    const credFile = join(home, '.credentials.yaml')
    if (existsSync(credFile)) {
      for (const line of readFileSync(credFile, 'utf8').split(/\r?\n/)) {
        const m = /^\s*DEEPSEEK_API_KEY\s*:\s*(.+?)\s*$/.exec(line)
        if (m) {
          const v = m[1].trim().replace(/^["']|["']$/g, '').trim()
          if (v) return { key: v, source: '.credentials.yaml' }
        }
      }
    }
  } catch {
    /* 凭据文件不可读则继续回退 */
  }

  return null
}

/** 查询余额（60 秒内存缓存；force 跳过缓存）。 */
export async function fetchBalance(force = false) {
  const now = Date.now()
  if (!force && cache.payload && now - cache.ts < CACHE_MS) {
    return { ...cache.payload, fromCache: true }
  }

  const found = deepSeekKey()
  if (!found) {
    const err = {
      ok: false,
      fetchedAt: new Date().toISOString(),
      error: `未找到 DeepSeek API Key（可设环境变量 DEEPSEEK_API_KEY，或写入 ${dshHome()}/${NAME}/config.json 的 "deepseekApiKey"）`,
    }
    cache = { ts: now, payload: err }
    return err
  }

  try {
    const res = await fetch(BALANCE_URL, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${found.key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      const err = {
        ok: false,
        http: res.status,
        fetchedAt: new Date().toISOString(),
        error: `DeepSeek 余额接口返回 ${res.status}${body ? `：${body.slice(0, 300)}` : ''}`,
      }
      cache = { ts: now, payload: err }
      return err
    }
    const body = await res.json()
    const data = {
      ok: true,
      fetchedAt: new Date().toISOString(),
      fromCache: false,
      keySource: found.source,
      is_available: body?.is_available,
      balance_infos: Array.isArray(body?.balance_infos) ? body.balance_infos : [],
    }
    cache = { ts: now, payload: data }
    return data
  } catch (e) {
    const err = {
      ok: false,
      fetchedAt: new Date().toISOString(),
      error: `查询余额失败：${String((e && e.message) || e)}`,
    }
    cache = { ts: now, payload: err }
    return err
  }
}

/**
 * Host 插件本体（官方函数导出形式）。所有资源在 apply 内用 ctx.effect 注册并返回清理函数。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  if (!ctx.webServer || typeof ctx.webServer.register !== 'function') {
    console.warn(`[${NAME}] webServer 服务不可用，${ROUTE_PATH} 未注册`)
    return
  }
  ctx.effect(() => {
    const off = ctx.webServer.register({
      kind: 'exact',
      path: ROUTE_PATH,
      handler: async (req, res) => {
        const send = (code, obj) => {
          res.writeHead(code, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          })
          res.end(JSON.stringify(obj))
        }
        try {
          const force = /[?&]refresh=1/.test(String(req.url || ''))
          send(200, await fetchBalance(force))
        } catch (e) {
          send(500, { ok: false, error: String((e && e.message) || e) })
        }
      },
    })
    return () => {
      if (typeof off === 'function') off()
    }
  })
  console.log(`[${NAME}] READY: GET ${ROUTE_PATH} 已注册`)
}
