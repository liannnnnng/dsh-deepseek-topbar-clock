/**
 * 合并恢复 profile 的用户配置行
 * ---------------------------------------------------------------
 * 背景：如果插件在启动审计阶段激活失败，DESKTOP 会触发原生致命恢复
 * （`sanitizeProfile`）：把 profile 的 `cordis.patch.yml` 重命名成
 * `.bak-<时间戳>` 并重写成一份最小默认文件 —— 用户自定义行（provider、主题、
 * 模型清单等）会随之丢失。
 *
 * 本脚本用「合并」而不是整体覆盖：以备份快照为基底，把当前文件里的行覆盖上去
 * （保留应用设置面板刚写的新值），并补回快照里有而当前文件缺的行。
 *
 * 用法：
 *   node tools/restore-profile-config.mjs                          预演（用 profile 目录下所有 .bak-* 作快照）
 *   node tools/restore-profile-config.mjs --apply                  写回
 *   node tools/restore-profile-config.mjs --from <file> [--from …] 指定快照文件（可多次，越靠后优先级越高）
 *   node tools/restore-profile-config.mjs --profile <dir>          指定 profile 目录
 */
import { copyFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { argValue, dshHome, profileDir } from './paths.mjs'

/** js-yaml 从 profile 的 node_modules 里解析（DSH 自带），失败再退回本仓库依赖。 */
const yaml = (() => {
  for (const base of [`${profileDir()}/`, `${dshHome()}/profiles/`, process.cwd() + '/']) {
    try {
      return createRequire(base + 'package.json')('js-yaml')
    } catch {
      /* 换下一个候选 */
    }
  }
  throw new Error('找不到 js-yaml：可从 DSH profile 的 node_modules 解析，或在本仓库 npm i js-yaml')
})()

const PROFILE = profileDir()
const TARGET = join(PROFILE, 'cordis.patch.yml')

/** 显式 --from 优先；否则自动收集 profile 目录下的 .bak-* 快照（越新优先级越高）。 */
function snapshotFiles() {
  const explicit = []
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === '--from' && process.argv[i + 1]) explicit.push(process.argv[i + 1])
  }
  if (explicit.length) return explicit
  const auto = readdirSync(PROFILE)
    .filter((f) => f.startsWith('cordis.patch.yml'))
    .filter((f) => f !== 'cordis.patch.yml')
    .map((f) => join(PROFILE, f))
    .map((f) => ({ f, t: statSync(f).mtimeMs }))
    .sort((a, b) => a.t - b.t) // 越新优先级越高
    .map((x) => x.f)
  return auto
}

const SOURCES = snapshotFiles()

const apply = process.argv.includes('--apply')

/** 按 id 合并：后出现的行覆盖先出现的同 id 行，保留首次出现的顺序。 */
function mergeRows(...lists) {
  const order = []
  const byId = new Map()
  for (const list of lists) {
    for (const row of list ?? []) {
      const key = row.id ?? `__insert_${order.length}`
      if (!byId.has(key)) order.push(key)
      byId.set(key, row)
    }
  }
  return order.map((k) => byId.get(k))
}

const current = yaml.load(readFileSync(TARGET, 'utf8')) ?? []
const originals = SOURCES.filter((f) => existsSync(f)).map((f) => ({ file: f, rows: yaml.load(readFileSync(f, 'utf8')) ?? [] }))

if (originals.length === 0) {
  console.error('找不到任何备份文件，无法恢复：' + SOURCES.join('、'))
  process.exit(1)
}

// 优先级（低→高）：备份快照按 SOURCES 顺序 → 当前文件（最新）
const merged = mergeRows(...originals.map((o) => o.rows), current)

const currentIds = new Set(current.map((r) => r.id))
const restored = merged.filter((r) => r.id && !currentIds.has(r.id)).map((r) => r.id)

console.log('目标文件：' + TARGET)
originals.forEach((o) => console.log(`基准：${o.file}（${o.rows.length} 行）`))
console.log(`当前：${current.length} 行 → 合并后：${merged.length} 行`)
console.log('将新增/恢复的行：' + (restored.join('、') || '（无）'))

if (!apply) {
  console.log('\n预演完成。加 --apply 写回。')
  process.exit(0)
}

const backup = `${TARGET}.bak-before-restore`
copyFileSync(TARGET, backup)
writeFileSync(TARGET, yaml.dump(merged, { lineWidth: 200, noRefs: true }))
console.log(`\n已写回 ${TARGET}（写前快照：${backup}）`)
console.log('重启桌面端后生效。')
