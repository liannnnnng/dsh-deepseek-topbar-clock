/**
 * dsh-deepseek-topbar-clock — 浏览器端 bundle
 * ---------------------------------------------------------------------------
 * 在 DSH 会话标题栏右侧（conversation.session.header.utilities 槽位）注入两个挂件：
 *
 *  1) 峰谷计价时钟 — 北京时间 周X HH:MM:SS + 计价档位
 *       高峰（周一至周五 09:00–12:00、14:00–18:00）→ 红「高峰 ×2」
 *       其余时段（含周六/周日全天）→ 绿「空闲·半价 ×1」
 *  2) DeepSeek 余额 — 点击强制刷新，调 GET /api/deepseek-balance
 *       悬停显示 总余额/赠送/充值/Key 来源/缓存状态/更新时间
 *
 * 宿主半在 src/index.mjs（注册 /api/deepseek-balance 并持有 API Key）。
 * 本文件是纯浏览器 bundle：只注册 factory，模块副作用在物化时运行。
 */
window.__ModuleLoader__.load({
  id: 'dsh-deepseek-topbar-clock',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    const API = '/api/deepseek-balance'
    const BALANCE_POLL_MS = 60_000
    /** 与 package.json 的 version 保持一致；渲染到 data 属性上，方便确认页面跑的是哪一版。 */
    const VERSION = '0.1.0'

    // —— 计价窗口（北京时间）：周一至周五 09:00–12:00、14:00–18:00 为高峰 ——
    const PEAK_WINDOWS = [
      [9 * 60, 12 * 60],
      [14 * 60, 18 * 60],
    ]
    const WINDOW_TEXT = '周一至周五 09:00–12:00、14:00–18:00'
    const PEAK_TITLE =
      'DeepSeek 计价（北京时间）：高峰 ' + WINDOW_TEXT + '（全价 ×2）；' +
      '其余时段与周末全天为空闲时段，价格为高峰的一半（×1）。'

    // —— 样式（用 DSH 主题 token，浅色/深色自适应）——
    const CSS = [
      '.ds-topbar-item{display:inline-flex;align-items:center;gap:5px;font-size:11px;line-height:1;white-space:nowrap;font-variant-numeric:tabular-nums;flex-shrink:0}',
      '.ds-topbar-clock{color:var(--dsw-alias-label-secondary);cursor:default}',
      '.ds-topbar-clock.ds-peak{color:var(--dsw-alias-state-error-primary)}',
      '.ds-topbar-clock.ds-idle{color:var(--dsw-alias-state-success-primary)}',
      '.ds-topbar-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex-shrink:0}',
      '.ds-topbar-clock .ds-clock-time{opacity:.85}',
      '.ds-topbar-clock .ds-clock-tier{font-weight:600}',
      '.ds-topbar-balance{background:none;border:none;padding:0;font:inherit;font-size:11px;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:color .12s var(--ds-ease-in-out, ease)}',
      '.ds-topbar-balance:hover{color:var(--dsw-alias-label-primary)}',
      '.ds-topbar-balance.ds-warn{color:var(--dsw-alias-state-warn-primary)}',
      '.ds-topbar-balance.ds-error{color:var(--dsw-alias-state-error-primary)}',
      '.ds-topbar-balance .ds-balance-value{font-weight:600}',
      '.ds-balance-spin{animation:ds-balance-spin 1s linear infinite}',
      '@keyframes ds-balance-spin{to{transform:rotate(360deg)}}',
    ].join('')

    // —— 北京时间拆解（无夏令时，恒 UTC+8）——
    const TIME_FMT = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    const WEEKDAY_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', weekday: 'short' })

    function shanghaiParts(now) {
      let weekday = ''
      let hour = 0
      let minute = 0
      let second = 0
      try {
        for (const part of TIME_FMT.formatToParts(now)) {
          if (part.type === 'weekday') weekday = part.value
          else if (part.type === 'hour') hour = parseInt(part.value, 10)
          else if (part.type === 'minute') minute = parseInt(part.value, 10)
          else if (part.type === 'second') second = parseInt(part.value, 10)
        }
      } catch {
        /* 环境不支持时回退本地时间 */
        weekday = '周' + '日一二三四五六'[now.getDay()]
        hour = now.getHours()
        minute = now.getMinutes()
        second = now.getSeconds()
      }
      let enWeekday = ''
      try {
        for (const part of WEEKDAY_FMT.formatToParts(now)) {
          if (part.type === 'weekday') enWeekday = part.value
        }
      } catch {
        enWeekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][now.getDay()]
      }
      return { weekday, enWeekday, hour, minute, second }
    }

    const pad = (n) => (n < 10 ? '0' + n : String(n))

    function peakState(parts) {
      const weekend = parts.enWeekday === 'Sat' || parts.enWeekday === 'Sun'
      const mins = parts.hour * 60 + parts.minute
      const peak = !weekend && PEAK_WINDOWS.some(([from, to]) => mins >= from && mins < to)
      return { peak, weekend }
    }

    // —— 挂件 1：北京时间峰谷时钟 ——
    function PeakClock() {
      const [now, setNow] = React.useState(() => new Date())
      React.useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 1000)
        return () => clearInterval(id)
      }, [])
      const parts = shanghaiParts(now)
      const { peak, weekend } = peakState(parts)
      const tier = peak ? '高峰 ×2' : (weekend ? '周末·半价 ×1' : '空闲·半价 ×1')
      return React.createElement(
        'div',
        {
          className: 'ds-topbar-item ds-topbar-clock ' + (peak ? 'ds-peak' : 'ds-idle'),
          'data-ds-peak-clock': 'true',
          'data-ds-version': VERSION,
          title:
            PEAK_TITLE +
            '\n当前：' + parts.weekday + ' ' + pad(parts.hour) + ':' + pad(parts.minute) + ':' + pad(parts.second) +
            '（北京时间）· ' + (peak ? '高峰时段，全价' : weekend ? '周末，全天半价' : '空闲时段，半价'),
        },
        React.createElement('span', { className: 'ds-topbar-dot', 'aria-hidden': 'true' }),
        React.createElement('span', null, parts.weekday),
        React.createElement('span', { className: 'ds-clock-time' }, pad(parts.hour) + ':' + pad(parts.minute) + ':' + pad(parts.second)),
        React.createElement('span', { className: 'ds-clock-tier' }, tier),
      )
    }

    // —— 挂件 2：DeepSeek 余额 ——
    function Balance() {
      const [state, setState] = React.useState({ loading: true, data: null, error: null })

      const load = React.useCallback((force) => {
        setState((s) => ({ loading: true, data: s.data, error: null }))
        fetch(API + (force ? '?refresh=1' : ''), { cache: 'no-store' })
          .then((r) => r.json())
          .then((json) => {
            if (json && json.ok) setState({ loading: false, data: json, error: null })
            else setState({ loading: false, data: null, error: (json && json.error) || '请求失败' })
          })
          .catch((e) => setState({ loading: false, data: null, error: String((e && e.message) || e) }))
      }, [])

      React.useEffect(() => {
        load(false)
        const id = setInterval(() => load(false), BALANCE_POLL_MS)
        return () => clearInterval(id)
      }, [load])

      const data = state.data
      const info = data && Array.isArray(data.balance_infos) ? data.balance_infos[0] : null
      const available = data ? data.is_available !== false : true
      const symbol = info && info.currency === 'USD' ? '$' : '¥'
      const text = state.loading && !data ? '…' : info ? symbol + Number(info.total_balance || 0).toFixed(2) : '—'
      const cls = state.error || (data && !available) ? (state.error ? ' ds-warn' : ' ds-error') : ''

      let tip = 'DeepSeek 账户余额（点击强制刷新）'
      if (info) {
        tip +=
          '\n总余额：' + info.total_balance + ' ' + (info.currency || 'CNY') +
          '　赠送：' + (info.granted_balance || '0') +
          '　充值：' + (info.topped_up_balance || '0')
      }
      if (data && !available) tip += '\n⚠ 该账户余额当前不可用于 API 调用'
      if (state.error) tip += '\n' + state.error
      if (info) {
        tip +=
          '\n来源：' + (data.keySource || '?') +
          (data.fromCache ? '（60 秒缓存，点击强制刷新）' : '（已强制刷新）') +
          '　更新于 ' + (data.fetchedAt || '').replace('T', ' ').slice(0, 19)
      }

      const icon = state.loading
        ? React.createElement('svg', {
            className: 'ds-balance-spin', width: 11, height: 11, viewBox: '0 0 24 24',
            fill: 'none', stroke: 'currentColor', strokeWidth: 2, 'aria-hidden': 'true',
            children: React.createElement('path', { d: 'M21 12a9 9 0 0 0-9-9', strokeLinecap: 'round' }),
          })
        : React.createElement(
            'svg',
            {
              width: 11, height: 11, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
              strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
            },
            React.createElement('path', { d: 'M20 11a8 8 0 1 0 2 5.3' }),
            React.createElement('polyline', { points: '20 4 20 11 13 11' }),
          )

      return React.createElement(
        'button',
        {
          type: 'button',
          className: 'ds-topbar-item ds-topbar-balance' + cls,
          'data-ds-balance': 'true',
          'data-ds-version': VERSION,
          title: tip,
          onClick: () => load(true),
        },
        React.createElement('span', { style: { opacity: 0.75 } }, '余额'),
        React.createElement('span', { className: 'ds-balance-value' }, text),
        icon,
      )
    }

    const SLOT = 'conversation.session.header.utilities'

    /**
     * 在槽位「已声明」之后注册挂件。
     *
     * 为什么不能直接 register：Slots 服务在槽位未被父条目 children 表声明时
     * 会抛 `slot "..." is not declared`，而各 client 插件的 apply 顺序不保证
     * （我们的 apply 可能早于 dsh-client-ui-conversation）。
     *
     * 为什么不能用 ctx.slots.inject(ownerKey, cb)：那是 0.1.x 文档/模板里的写法，
     * 本机桌面端跑的 0.2.0-rc.2 的 slots 服务**没有 inject 方法**（实测其
     * lib/index.js 中无该方法），调用它会直接抛错 → 客户端 entry 激活失败 →
     * 桌面端 web boot 致命退出。可用的是 subscribe(key, fn)：
     * 它允许在槽位声明之前先订阅，声明发生时回调。
     */
    function registerWhenDeclared(ctx, slots, registration, Component, seen) {
      const tryRegister = () => {
        if (seen.off !== null) return
        try {
          const off = slots.register(registration, Component)
          seen.off = typeof off === 'function' ? off : () => {}
          if (seen.unsubscribe !== null) {
            seen.unsubscribe()
            seen.unsubscribe = null
          }
        } catch {
          /* 槽位尚未声明：等 subscribe 回调或下一跳重试 */
        }
      }
      if (typeof slots.subscribe === 'function') {
        const off = slots.subscribe(SLOT, tryRegister)
        seen.unsubscribe = () => {
          if (typeof off === 'function') off()
        }
        seen.off = null
        ctx.effect(() => () => {
          if (seen.unsubscribe !== null) seen.unsubscribe()
          if (seen.off !== null) seen.off()
        })
        tryRegister()
        return
      }
      // 兜底：老版本可能没有 subscribe，直接注册并保证重复调用幂等
      tryRegister()
      seen.off = seen.off ?? (() => {})
    }

    const plugin = {
      /*
       * 只注入 'slots'（提供 ctx.slots）。
       * 注意：不要在这里声明 @deepseek-ai/dsh-client-ui-conversation —— 它没有
       * 导出可注入的同名服务，声明会挂起等待；顺序问题改用 subscribe(SLOT) 解决。
       */
      inject: ['slots'],
      apply(ctx) {
        const slots = ctx.slots
        if (slots === undefined) {
          console.warn('[dsh-deepseek-topbar-clock] slots 服务不可用，顶部栏挂件未注册')
          return
        }

        // 样式随插件生命周期注入/移除
        ctx.effect(() => {
          const el = document.createElement('style')
          el.setAttribute('data-dsh-deepseek-topbar-clock', '')
          el.textContent = CSS
          document.head.appendChild(el)
          return () => el.remove()
        })

        registerWhenDeclared(
          ctx,
          slots,
          { name: SLOT, id: 'ds-peak-clock', order: -20 },
          PeakClock,
          { off: null, unsubscribe: null },
        )
        registerWhenDeclared(
          ctx,
          slots,
          { name: SLOT, id: 'ds-balance', order: -19 },
          Balance,
          { off: null, unsubscribe: null },
        )
      },
    }

    exports.default = plugin
    exports.apply = plugin.apply
    exports.inject = plugin.inject
    return module.exports
  },
})
