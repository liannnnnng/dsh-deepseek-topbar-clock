/**
 * 一键回滚：把 profile 恢复到安装本插件之前的状态
 * ---------------------------------------------------------------
 *   node tools/rollback.mjs                        预演（只打印）
 *   node tools/rollback.mjs --apply                执行
 *   node tools/rollback.mjs --apply --profile <dir>   指定 profile 目录
 *
 * 做了什么：
 *   1. 从 profile 的 package.json 移除本插件的依赖与 bundle 行
 *      （移除前把当前 package.json 另存一份 .bak-before-rollback）
 *   2. 顺带运行 restore-profile-config.mjs，合并恢复被应用清掉的用户配置行
 *   3. 其它文件（含 ~/.dsh/.credentials.yaml —— 浏览器会话密钥在那里）保持不动，
 *      整体还原旧快照会让当前登录态失效
 *
 * 回滚后完全退出并重启应用（Desktop 需重启，web 需重启 dsh web）。
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { profileDir } from './paths.mjs'

const ID = 'dsh-deepseek-topbar-clock'
const PROFILE = profileDir()
const PKG = `${PROFILE}/package.json`
const apply = process.argv.includes('--apply')

if (!existsSync(PKG)) {
  console.error(`找不到 profile 的 package.json：${PKG}\n用 --profile <dir> 指定 profile 目录，或设置 DSH_PROFILE_DIR。`)
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(PKG, 'utf8'))
const deps = manifest.dependencies ?? {}
const bundles = manifest?.dsh?.profile?.bundles ?? []

const actions = []
if (ID in deps) actions.push(`从 dependencies 移除 ${ID}`)
if (bundles.includes(ID)) actions.push(`从 dsh.profile.bundles 移除 ${ID}`)

console.log('profile: ' + PROFILE)
console.log('当前依赖: ' + (Object.keys(deps).join(', ') || '（无）'))
console.log('当前 bundles: ' + (bundles.join(', ') || '（无）'))
console.log('将执行: ' + (actions.join('；') || '（无需改动 package.json）'))
console.log('另外: 运行 restore-profile-config.mjs 恢复被应用清掉的用户配置行')

if (!apply) {
  console.log('\n预演完成。加 --apply 执行。')
  process.exit(0)
}

if (actions.length) {
  copyFileSync(PKG, `${PKG}.bak-before-rollback`)
  delete deps[ID]
  manifest.dependencies = deps
  if (manifest?.dsh?.profile) manifest.dsh.profile.bundles = bundles.filter((b) => b !== ID)
  writeFileSync(PKG, JSON.stringify(manifest, null, 2) + '\n')
  console.log('已更新 ' + PKG)
}

// 恢复用户配置行
try {
  const helper = fileURLToPath(new URL('./restore-profile-config.mjs', import.meta.url))
  execFileSync(process.execPath, [helper, '--apply', '--profile', PROFILE], { stdio: 'inherit' })
} catch (e) {
  console.log('恢复配置行失败（可手工运行 tools/restore-profile-config.mjs --apply）：' + String(e && e.message))
}

const inst = `${PROFILE}/node_modules/${ID}`
if (existsSync(inst)) console.log('提示: 安装链接仍在 ' + inst + '，确认无用后可删除。')

console.log('\n回滚完成。请完全退出并重启应用。')
