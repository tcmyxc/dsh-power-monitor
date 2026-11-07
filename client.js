/**
 * dsh-power-monitor — Client half.
 *
 * A compact live power card in the left sidebar, stacked directly above the
 * account row. It shows wall power, today's cost and energy, and a recent
 * sparkline; expanding it adds the per-component split and the three
 * calibration values.
 */
window.__ModuleLoader__.load({
  id: 'dsh-power-monitor',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'power-monitor'
    const ENDPOINT = '/plugins/dsh-power-monitor/api'
    const RPC_CHANNEL = '/power-monitor'
    const POLL_VISIBLE_MS = 2500
    const POLL_HIDDEN_MS = 10000

    const DICTS = {
      en: {
        title: 'Power monitor',
        open: 'Show power details',
        close: 'Hide power details',
        now: 'now',
        today: 'today',
        month: 'this month',
        run: 'this run',
        tariff: 'Tariff',
        perKwh: 'per kWh',
        cpuTdp: 'CPU TDP',
        otherHardware: 'Other hardware',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved',
        cpu: 'CPU',
        gpu: 'GPU',
        other: 'Other',
        loading: 'Reading power…',
        error: 'Power data unavailable',
        cpuSourceLhm: 'CPU measured by LibreHardwareMonitor',
        cpuSourceModel: 'CPU estimated from load and TDP',
        gpuSourceNvidia: 'GPU measured by nvidia-smi',
        gpuSourceLhm: 'GPU measured by LibreHardwareMonitor',
        gpuSourceNone: 'No GPU power source',
        hint: 'Run LibreHardwareMonitor with its web server on port 8085 for measured CPU power.',
        efficiency: 'PSU efficiency',
      },
      'zh-CN': {
        title: '功耗监控',
        open: '展开功耗详情',
        close: '收起功耗详情',
        now: '当前',
        today: '今日',
        month: '本月',
        run: '本次运行',
        tariff: '电价',
        perKwh: '元/度',
        cpuTdp: 'CPU 功耗上限',
        otherHardware: '其他硬件',
        save: '保存',
        saving: '保存中…',
        saved: '已保存',
        cpu: 'CPU',
        gpu: 'GPU',
        other: '其他',
        loading: '正在读取功耗…',
        error: '无法读取功耗数据',
        cpuSourceLhm: 'CPU 由 LibreHardwareMonitor 实测',
        cpuSourceModel: 'CPU 按使用率与 TDP 估算',
        gpuSourceNvidia: 'GPU 由 nvidia-smi 实测',
        gpuSourceLhm: 'GPU 由 LibreHardwareMonitor 实测',
        gpuSourceNone: '没有可用的 GPU 功耗来源',
        hint: '安装并启动 LibreHardwareMonitor，开启 Web 服务器（8085 端口）后可获得实测 CPU 功耗。',
        efficiency: '电源效率',
      },
    }
    DICTS.zh = DICTS['zh-CN']

    const CSS = `
      :has(> .pm-footer-stack),
      :has(> [data-slot="sidebar.footer.action"] > .pm-footer-stack) {
        flex-wrap: wrap; flex: 0 0 auto; height: auto; min-height: 0; align-content: flex-start;
      }
      :has(> div > [data-slot="sidebar.footer.action"] > .pm-footer-stack) {
        flex: 0 0 auto; height: auto; min-height: 0;
      }
      :has(> .pm-footer-stack.pm-rail),
      :has(> [data-slot="sidebar.footer.action"] > .pm-footer-stack.pm-rail) {
        flex-direction: column; flex-wrap: nowrap; align-items: center; gap: 6px;
      }
      .pm-footer-stack { display: flex; flex: none; order: -1; flex-direction: column; gap: 6px; width: 100%; min-width: 0; max-width: 100%; align-items: stretch; box-sizing: border-box; }
      .pm-footer-stack.pm-rail { order: 1; width: auto; align-items: center; }
      .pm-card { display: flex; flex-direction: column; gap: 4px; width: 100%; box-sizing: border-box; padding: 7px 9px; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; text-align: left; cursor: pointer; transition: border-color 120ms ease; }
      .pm-card:hover { border-color: var(--dsw-alias-border-l2); }
      .pm-card:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
      .pm-card[data-state="error"] .pm-card-w { color: var(--dsw-alias-state-warn-primary); }
      .pm-card-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
      .pm-card-w { display: inline-flex; align-items: center; gap: 4px; font-size: 16px; font-weight: 650; line-height: 1.15; font-variant-numeric: tabular-nums; }
      .pm-card-w .pm-unit { font-size: 11px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
      .pm-card-cost { font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
      .pm-card-sub { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: 11px; line-height: 15px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
      .pm-bolt { flex: none; color: var(--dsw-alias-brand-primary); }
      .pm-num { font-variant-numeric: tabular-nums; }
      .pm-dim { color: var(--dsw-alias-label-secondary); }
      .pm-spark { display: block; overflow: visible; flex: none; }
      .pm-detail { display: flex; flex-direction: column; gap: 8px; padding: 9px; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); max-height: 42vh; overflow: auto; }
      .pm-detail-head { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
      .pm-row { display: flex; align-items: center; gap: 6px; font-size: 11px; }
      .pm-row-name { flex: none; width: 34px; color: var(--dsw-alias-label-secondary); }
      .pm-bar { display: block; flex: 1; height: 4px; border-radius: 2px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; }
      .pm-bar > i { display: block; height: 100%; border-radius: inherit; background: var(--dsw-alias-brand-primary); }
      .pm-row[data-kind="gpu"] .pm-bar > i { background: var(--dsw-alias-state-success-primary); }
      .pm-row[data-kind="other"] .pm-bar > i { background: var(--dsw-alias-state-idle-primary); }
      .pm-row-w { flex: none; min-width: 44px; text-align: right; font-variant-numeric: tabular-nums; }
      .pm-row-pct { flex: none; min-width: 28px; text-align: right; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
      .pm-summary { display: flex; flex-wrap: wrap; gap: 2px 10px; font-size: 11px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
      .pm-summary b { color: var(--dsw-alias-label-primary); font-weight: 600; }
      .pm-sources { display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
      .pm-source { display: flex; align-items: center; gap: 5px; min-width: 0; }
      .pm-source > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pm-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); flex: none; }
      .pm-dot[data-on="true"] { background: var(--dsw-alias-state-success-primary); }
      .pm-form { display: flex; flex-direction: column; gap: 6px; padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l1); }
      .pm-field { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
      .pm-input { width: 74px; box-sizing: border-box; padding: 2px 6px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; text-align: right; font-variant-numeric: tabular-nums; }
      .pm-input:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 0; border-color: transparent; }
      .pm-form-foot { display: flex; align-items: center; gap: 8px; justify-content: flex-end; }
      .pm-save { padding: 2px 12px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; font-size: 11px; cursor: pointer; }
      .pm-save:hover { border-color: var(--dsw-alias-brand-primary); }
      .pm-save:disabled { opacity: .55; cursor: default; }
      .pm-ok { color: var(--dsw-alias-state-success-primary); font-size: 11px; }
      .pm-fail { color: var(--dsw-alias-state-error-primary); font-size: 11px; overflow-wrap: anywhere; }
      .pm-hint { font-size: 11px; line-height: 15px; color: var(--dsw-alias-label-secondary); }
      .pm-hint b { color: var(--dsw-alias-label-primary); font-weight: 500; }
      .pm-rail-card { display: flex; flex-direction: column; align-items: center; gap: 1px; width: 40px; padding: 5px 0; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 10px; line-height: 13px; font-variant-numeric: tabular-nums; }
      .pm-rail-card[data-state="error"] { color: var(--dsw-alias-state-warn-primary); }
    `

    function translate(ctx) {
      const locale = ctx.get('locale')
      let bound = null
      if (locale) {
        try {
          bound = locale.bind(NS)
        } catch {
          bound = null
        }
      }
      return (key, params) => {
        let text = key
        try {
          const value = bound ? bound(key) : key
          if (typeof value === 'string' && value !== '') text = value
        } catch {
          text = key
        }
        if (params) {
          text = text.replace(/\{(\w+)\}/g, (match, name) =>
            Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
          )
        }
        return text
      }
    }

    function useTranslate(ctx) {
      const locale = ctx.get('locale')
      const subscribe = React.useCallback(
        (callback) => (locale ? locale.subscribe(callback) : () => {}),
        [locale],
      )
      const getRevision = React.useCallback(() => (locale ? locale.getSnapshot().revision : 0), [locale])
      React.useSyncExternalStore(subscribe, getRevision, getRevision)
      return translate(ctx)
    }

    function withTimeout(ms) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), ms)
      return {
        signal: controller.signal,
        done: () => clearTimeout(timer),
      }
    }

    function formatWatts(value) {
      if (!Number.isFinite(value)) return '—'
      return value >= 100 ? String(Math.round(value)) : value.toFixed(1)
    }

    function formatKwh(wh) {
      if (!Number.isFinite(wh)) return '0.000'
      return (wh / 1000).toFixed(3)
    }

    function formatMoney(symbol, value) {
      const prefix = symbol || ''
      if (!Number.isFinite(value)) return `${prefix}—`
      if (value === 0) return `${prefix}0.00`
      if (value < 0.01) return `${prefix}${value.toFixed(4)}`
      if (value < 1) return `${prefix}${value.toFixed(3)}`
      return `${prefix}${value.toFixed(2)}`
    }

    function Sparkline({ points, width = 72, height = 18, stretch = false }) {
      if (!Array.isArray(points) || points.length < 2) return null
      const values = points.map((point) => (Number.isFinite(point.w) ? point.w : 0))
      const min = Math.min(...values)
      const max = Math.max(...values)
      const span = max - min || 1
      const boxWidth = stretch ? 100 : width
      const boxHeight = stretch ? 20 : height
      const pad = 1.5
      const step = boxWidth / (values.length - 1)
      const coords = values.map((value, index) => {
        const x = index * step
        const y = boxHeight - pad - ((value - min) / span) * (boxHeight - pad * 2)
        return `${x.toFixed(2)},${y.toFixed(2)}`
      })
      const style = stretch ? { width: '100%', height: 18 } : { width, height }
      return h(
        'svg',
        {
          className: 'pm-spark',
          viewBox: `0 0 ${boxWidth} ${boxHeight}`,
          preserveAspectRatio: 'none',
          style,
          'aria-hidden': 'true',
        },
        h('polyline', {
          points: coords.join(' '),
          fill: 'none',
          stroke: 'var(--dsw-alias-brand-primary)',
          strokeWidth: stretch ? 1.4 : 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    function BoltIcon({ size = 14 }) {
      return h(
        'svg',
        {
          className: 'pm-bolt',
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          'aria-hidden': 'true',
          fill: 'none',
        },
        h('path', {
          d: 'M13.2 2.5 5.6 13.4h5.1l-1.5 8.1 8.2-11.6h-5.2z',
          fill: 'currentColor',
        }),
      )
    }

    async function requestSnapshot(ctx, timeoutMs = 8000) {
      const connection = ctx.get('connection')
      const rpc = connection && connection.rpc
      let rpcError = ''
      if (rpc && typeof rpc.call === 'function') {
        const timeout = withTimeout(timeoutMs)
        try {
          const result = await rpc.call(RPC_CHANNEL, 'snapshot', {}, timeout.signal)
          if (result && result.ok) return result.value
          rpcError = result?.error?.message || result?.error?.code || 'RPC failed'
        } catch (error) {
          rpcError = String(error?.message ?? error)
        } finally {
          timeout.done()
        }
      }
      const timeout = withTimeout(timeoutMs)
      try {
        const response = await fetch(`${ENDPOINT}?action=snapshot`, {
          method: 'GET',
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
          signal: timeout.signal,
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const body = await response.json()
        if (!body || body.ok !== true) throw new Error(body?.error?.message || 'Request failed')
        return body.value
      } catch (error) {
        const message = String(error?.message ?? error)
        throw new Error(rpcError ? `${rpcError} / ${message}` : message)
      } finally {
        timeout.done()
      }
    }

    async function saveSettings(ctx, patch) {
      const connection = ctx.get('connection')
      const rpc = connection && connection.rpc
      let rpcError = ''
      if (rpc && typeof rpc.call === 'function') {
        const timeout = withTimeout(8000)
        try {
          const result = await rpc.call(RPC_CHANNEL, 'settings', patch, timeout.signal)
          if (result && result.ok) return result.value
          rpcError = result?.error?.message || result?.error?.code || 'RPC failed'
        } catch (error) {
          rpcError = String(error?.message ?? error)
        } finally {
          timeout.done()
        }
      }
      const timeout = withTimeout(8000)
      try {
        const response = await fetch(ENDPOINT, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({ patch }),
          signal: timeout.signal,
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const body = await response.json()
        if (!body || body.ok !== true) throw new Error(body?.error?.message || 'Request failed')
        return body.value
      } catch (error) {
        const message = String(error?.message ?? error)
        throw new Error(rpcError ? `${rpcError} / ${message}` : message)
      } finally {
        timeout.done()
      }
    }

    function usePower(ctx, version) {
      const [state, setState] = React.useState({ status: 'loading' })
      React.useEffect(() => {
        let alive = true
        let timer = null
        const tick = async () => {
          if (!alive) return
          try {
            const value = await requestSnapshot(ctx)
            if (alive && value) setState({ status: 'ready', data: value })
          } catch (error) {
            if (alive) {
              setState((previous) =>
                previous.status === 'ready'
                  ? { ...previous, error: String(error?.message ?? error) }
                  : { status: 'error', error: String(error?.message ?? error) },
              )
            }
          }
          if (alive) {
            timer = setTimeout(tick, document.visibilityState === 'visible' ? POLL_VISIBLE_MS : POLL_HIDDEN_MS)
          }
        }
        void tick()
        const onVisibility = () => {
          if (document.visibilityState === 'visible') {
            if (timer) clearTimeout(timer)
            void tick()
          }
        }
        document.addEventListener('visibilitychange', onVisibility)
        return () => {
          alive = false
          if (timer) clearTimeout(timer)
          document.removeEventListener('visibilitychange', onVisibility)
        }
      }, [ctx, version])
      return state
    }

    function partRow(kind, label, watts, total, utilization) {
      const share = total > 0 ? Math.max(0, Math.min(1, watts / total)) : 0
      const percent =
        utilization === null || utilization === undefined
          ? `${Math.round(share * 100)}%`
          : `${Math.round(utilization)}%`
      return h(
        'div',
        { className: 'pm-row', 'data-kind': kind },
        h('span', { className: 'pm-row-name' }, label),
        h('span', { className: 'pm-bar', 'aria-hidden': 'true' }, h('i', { style: { width: `${Math.round(share * 100)}%` } })),
        h('span', { className: 'pm-row-w' }, `${formatWatts(watts)} W`),
        h('span', { className: 'pm-row-pct' }, percent),
      )
    }

    function sourceLine(kind, label, on, text) {
      return h(
        'span',
        { className: 'pm-source', key: kind },
        h('i', { className: 'pm-dot', 'data-on': on ? 'true' : 'false', 'aria-hidden': 'true' }),
        h('span', { className: 'pm-num' }, label),
        h('span', null, text),
      )
    }

    function field(label, value, step, onChange, suffix) {
      return h(
        'label',
        { className: 'pm-field' },
        h('span', null, label),
        h('span', { className: 'pm-num' }, h('input', {
          className: 'pm-input',
          type: 'number',
          inputMode: 'decimal',
          step,
          min: '0',
          value,
          onChange: (event) => onChange(event.target.value),
        }), suffix ? h('span', { className: 'pm-dim' }, ` ${suffix}`) : null),
      )
    }

    function PowerFooter({ ctx, wide = true }) {
      const t = useTranslate(ctx)
      const [open, setOpen] = React.useState(false)
      const [version, setVersion] = React.useState(0)
      const state = usePower(ctx, version)
      const data = state.status === 'ready' ? state.data : null

      const [form, setForm] = React.useState({ tariff: '', cpuTdp: '', baseWatts: '' })
      const [saving, setSaving] = React.useState(false)
      const [saved, setSaved] = React.useState(false)
      const [saveError, setSaveError] = React.useState('')
      const savedTimer = React.useRef(null)

      React.useEffect(() => {
        if (!open || !data) return
        setForm((current) =>
          current.tariff === ''
            ? {
                tariff: String(data.settings.tariff),
                cpuTdp: String(data.settings.cpuTdp),
                baseWatts: String(data.settings.baseWatts),
              }
            : current,
        )
      }, [open, data])

      React.useEffect(
        () => () => {
          if (savedTimer.current) clearTimeout(savedTimer.current)
        },
        [],
      )

      React.useEffect(() => {
        if (!open || !wide) return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [open, wide])

      const save = async () => {
        if (saving) return
        setSaving(true)
        setSaveError('')
        try {
          await saveSettings(ctx, {
            tariff: Number(form.tariff),
            cpuTdp: Number(form.cpuTdp),
            baseWatts: Number(form.baseWatts),
          })
          setSaved(true)
          setVersion((value) => value + 1)
          if (savedTimer.current) clearTimeout(savedTimer.current)
          savedTimer.current = setTimeout(() => setSaved(false), 2200)
        } catch (error) {
          setSaveError(String(error?.message ?? error))
        } finally {
          setSaving(false)
        }
      }

      const failed = state.status === 'error'
      const errorText = failed ? state.error : ''
      const watts = data?.watts ?? { total: 0, cpu: 0, gpu: 0, other: 0 }
      const symbol = data?.symbol ?? ''
      const todayMoney = data ? formatMoney(symbol, data.cost.today) : '—'
      const monthMoney = data ? formatMoney(symbol, data.cost.month) : '—'

      if (!wide) {
        const title = data
          ? `${formatWatts(watts.total)} W · ${t('today')} ${formatKwh(data.energy.todayWh)} kWh · ${todayMoney}`
          : failed
            ? errorText || t('error')
            : t('loading')
        return h(
          'div',
          { className: 'pm-footer-stack pm-rail' },
          h(
            'div',
            { className: 'pm-rail-card', 'data-state': failed ? 'error' : 'ok', title, role: 'status' },
            h(BoltIcon, { size: 14 }),
            h('span', { className: 'pm-num' }, data ? formatWatts(watts.total) : '—'),
            h('span', { className: 'pm-dim' }, 'W'),
          ),
        )
      }

      const card = h(
        'button',
        {
          type: 'button',
          className: 'pm-card',
          'data-state': failed ? 'error' : 'ok',
          'aria-expanded': open,
          title: failed ? errorText || t('error') : open ? t('close') : t('open'),
          onClick: () => setOpen((value) => !value),
        },
        h(
          'div',
          { className: 'pm-card-top' },
          h(
            'span',
            { className: 'pm-card-w' },
            h(BoltIcon, { size: 13 }),
            data ? formatWatts(watts.total) : '—',
            h('span', { className: 'pm-unit' }, 'W'),
          ),
          h('span', { className: 'pm-card-cost' }, failed ? t('error') : todayMoney),
        ),
        h(
          'div',
          { className: 'pm-card-sub' },
          h('span', null, `${t('today')} ${data ? formatKwh(data.energy.todayWh) : '—'} kWh`),
          h('span', null, `${t('month')} ${monthMoney}`),
        ),
        data ? h(Sparkline, { points: data.history, stretch: true }) : null,
      )

      const detail = open
        ? h(
            'div',
            { className: 'pm-detail', role: 'region', 'aria-label': t('title') },
            h(
              'div',
              { className: 'pm-detail-head' },
              h('span', null, t('title')),
              data ? h('span', { className: 'pm-num' }, `${t('run')} ${formatKwh(data.energy.sessionWh)} kWh`) : null,
            ),
            data
              ? h(
                  'div',
                  null,
                  h(
                    'div',
                    { className: 'pm-summary' },
                    h('span', null, t('today'), h('b', null, todayMoney)),
                    h('span', null, t('month'), h('b', null, monthMoney)),
                  ),
                  h(
                    'div',
                    { style: { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 } },
                    partRow('cpu', t('cpu'), watts.cpu, watts.total, data.cpu.load),
                    partRow('gpu', t('gpu'), watts.gpu, watts.total, data.gpus?.[0]?.utilization ?? null),
                    partRow('other', t('other'), watts.other, watts.total, null),
                  ),
                )
              : failed
                ? h('div', { className: 'pm-fail' }, errorText || t('error'))
                : h('div', { className: 'pm-dim' }, t('loading')),
            data
              ? h(
                  'div',
                  { className: 'pm-sources' },
                  sourceLine('cpu', t('cpu'), data.sources.cpu === 'lhm', data.sources.cpu === 'lhm' ? t('cpuSourceLhm') : t('cpuSourceModel')),
                  sourceLine(
                    'gpu',
                    t('gpu'),
                    data.sources.gpu !== 'none',
                    data.sources.gpu === 'nvidia-smi' ? t('gpuSourceNvidia') : data.sources.gpu === 'lhm' ? t('gpuSourceLhm') : t('gpuSourceNone'),
                  ),
                )
              : null,
            data
              ? h(
                  'div',
                  { className: 'pm-form' },
                  field(t('tariff'), form.tariff, '0.01', (value) => setForm((current) => ({ ...current, tariff: value })), t('perKwh')),
                  field(t('cpuTdp'), form.cpuTdp, '1', (value) => setForm((current) => ({ ...current, cpuTdp: value })), 'W'),
                  field(t('otherHardware'), form.baseWatts, '1', (value) => setForm((current) => ({ ...current, baseWatts: value })), 'W'),
                  h(
                    'div',
                    { className: 'pm-form-foot' },
                    saved ? h('span', { className: 'pm-ok' }, t('saved')) : null,
                    saveError ? h('span', { className: 'pm-fail' }, saveError) : null,
                    h('button', { type: 'button', className: 'pm-save', disabled: saving, onClick: save }, saving ? t('saving') : t('save')),
                  ),
                )
              : null,
            data
              ? h(
                  'div',
                  { className: 'pm-hint' },
                  data.sources.cpu === 'lhm' ? null : t('hint'),
                  h('b', null, ` ${t('efficiency')}: ${Math.round(data.settings.psuEfficiency * 100)}%`),
                )
              : null,
          )
        : null

      return h('div', { className: 'pm-footer-stack' }, card, detail)
    }

    function mountStyles() {
      const existing = document.querySelector('style[data-plugin-css="dsh-power-monitor"]')
      const element = existing ?? document.createElement('style')
      element.dataset.plugin = 'dsh-power-monitor'
      element.dataset.pluginCss = 'dsh-power-monitor'
      element.textContent = CSS
      if (!existing) document.head.appendChild(element)
      return () => {
        if (element.parentNode) element.parentNode.removeChild(element)
      }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const locale = ctx.get('locale')
        if (locale) {
          ctx.effect(() => {
            const disposers = []
            for (const [id, dict] of Object.entries(DICTS)) {
              try {
                disposers.push(locale.register(NS, id, dict))
              } catch {
                // A dictionary already owned by this locale is left untouched.
              }
            }
            return () => {
              for (const dispose of disposers) {
                try {
                  dispose()
                } catch {
                  // Ignore duplicate disposal.
                }
              }
            }
          }, 'power-monitor: locale dictionaries')
        }

        ctx.effect(() => mountStyles(), 'power-monitor: styles')

        ctx.effect(
          () =>
            ctx.slots.inject('sidebar.footer.action', () =>
              ctx.slots.register(
                {
                  name: 'sidebar.footer.action',
                  id: 'dsh-power-monitor',
                  order: 10,
                },
                (props) => h(PowerFooter, { ...props, ctx }),
              ),
            ),
          'power-monitor: sidebar card',
        )
      },
    }
  },
})