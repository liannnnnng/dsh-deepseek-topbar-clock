/**
 * 客户端 bundle 的离线自测（不需要浏览器、不需要桌面端）
 * ---------------------------------------------------------------
 * 关键回归点：上一版用了 `ctx.slots.inject(...)`（0.1.x 文档 API），而本机桌面端
 * 的 0.2.0-rc.2 slots 服务没有该方法 → 客户端 entry 激活失败 → 桌面端 web boot
 * 致命退出。本测试用假的 slots 服务覆盖以下行为：
 *
 *   1. bundle 结构：id 与包名一致、factory 形态、require('react') 来自模块表
 *   2. 插件对象：inject = ['slots']，apply 可调用，不依赖 slots.inject
 *   3. 槽位未声明时 register 抛错 → 不炸、改为订阅等待
 *   4. 槽位声明后（subscribe 回调触发）自动注册成功，且只注册一次
 *   5. 卸载时注销订阅与已注册入口
 *
 * 用法：node test-client.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ID = 'dsh-deepseek-topbar-clock'
const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

// —— 最小 window / document / react 桩 ——
const styleTags = []
const globalWindow = {}
globalThis.window = globalWindow
globalThis.document = {
  createElement: (tag) => ({ tag, setAttribute() {}, remove() { const i = styleTags.indexOf(this); if (i >= 0) styleTags.splice(i, 1) }, textContent: '' }),
  head: { appendChild: (el) => styleTags.push(el) },
}

const react = {
  createElement: (...args) => ({ type: args[0], props: args[1], children: args.slice(2) }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  Fragment: 'Fragment',
}

// 1) 执行 bundle：只应注册 factory，不应立即运行模块体
let factory = null
globalWindow.__ModuleLoader__ = {
  load(reg) {
    assert.equal(reg.id, ID, 'bundle 注册的 id 必须等于包名')
    factory = reg.factory
  },
}
const mod = { exports: {} }
;(0, eval)(source) // bundle 是浏览器 classic script
assert.ok(typeof factory === 'function', 'bundle 必须注册 factory')

const exports_ = factory((name) => {
  if (name === 'react') return react
  throw new Error(`未预期的外部模块请求: ${name}`)
})
console.log('PASS  1/5 bundle 结构：id 与包名一致，factory 可用')

// 2) 插件对象形态
const plugin = exports_.default ?? exports_
assert.deepEqual(plugin.inject, ['slots'], '插件 inject 必须是 [\'slots\']')
assert.equal(typeof plugin.apply, 'function', 'apply 必须是函数')
assert.equal(plugin.apply, exports_.apply, 'apply 命名导出应与插件对象一致')
console.log('PASS  2/5 插件对象：inject=[\'slots\']，apply 为函数')

// 3)+4) 假 slots：未声明时 register 抛错；subscribe 后声明再注册
let declared = false
const registered = []
const subscriptions = []
const unsubscribed = []
const fakeSlots = {
  register(options, component) {
    if (!declared) throw new Error(`slot "${options.name}" is not declared (a parent entry's children table must declare it)`)
    registered.push({ options, component })
    return () => { registered.pop() }
  },
  subscribe(key, fn) {
    subscriptions.push({ key, fn })
    return () => unsubscribed.push(key)
  },
}

const effects = []
const fakeCtx = {
  slots: fakeSlots,
  effect(fn) {
    const off = fn()
    effects.push(off)
    return off
  },
}

plugin.apply(fakeCtx)
assert.equal(registered.length, 0, '槽位未声明时不应注册成功')
assert.equal(subscriptions.length, 2, '应订阅 2 次（两个挂件）')
assert.ok(subscriptions.every((s) => s.key === 'conversation.session.header.utilities'), '订阅的 key 应为目标槽位')
console.log('PASS  3/5 槽位未声明：register 抛错被吞掉，转为 subscribe 等待（未崩溃）')

// 声明后再触发 subscribe 回调
declared = true
for (const s of subscriptions) s.fn()
assert.equal(registered.length, 2, '槽位声明后两个挂件都应注册成功')
assert.deepEqual(
  registered.map((r) => r.options.id).sort(),
  ['ds-balance', 'ds-peak-clock'],
  '注册的两个挂件 id 应为 ds-balance / ds-peak-clock',
)
assert.deepEqual(
  registered.map((r) => r.options.order).sort((a, b) => a - b),
  [-20, -19],
  'order 应为 -20 / -19',
)
// 再次触发不应重复注册
for (const s of subscriptions) s.fn()
assert.equal(registered.length, 2, '重复回调不应重复注册')
console.log('PASS  4/5 槽位声明后自动注册两个挂件，且幂等')

// 5) 卸载：样式移除、订阅与注册注销
for (const off of effects) if (typeof off === 'function') off()
assert.equal(styleTags.length, 0, '卸载后注入的 style 应被移除')
assert.equal(unsubscribed.length, 2, '卸载后应注销 2 个订阅')
console.log('PASS  5/5 卸载清理：style 移除、订阅注销')

// 关键回归：可执行代码里不得再出现 0.2.0-rc.2 不存在的 slots.inject 调用
// （注释里保留对旧写法的说明是允许的，所以逐行判断是否在注释中）
const codeLines = source
  .split(/\r?\n/)
  .map((line) => {
    const t = line.trim()
    return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') ? '' : line
  })
  .join('\n')
assert.ok(
  !/slots\.inject\s*\(/.test(codeLines),
  '可执行代码里不得使用本机 slots 服务不存在的 inject()',
)
console.log('PASS  回归：可执行代码未使用 0.2.0-rc.2 不存在的 ctx.slots.inject()')
console.log('\n全部通过。')
