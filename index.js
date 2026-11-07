/**
 * dsh-power-monitor — Host half.
 *
 * Reads what this machine can actually measure:
 *   - NVIDIA GPUs through `nvidia-smi` (board power, utilization, temperature),
 *   - LibreHardwareMonitor's local web server when it is running (CPU/GPU package power),
 * and falls back to a CPU TDP model for whatever is still missing. The wall-side
 * total is integrated over time, so the panel can show energy and an electricity
 * cost estimate instead of only an instantaneous figure.
 *
 * Only Node built-ins are used: the bundle installs without a dependency step.
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** The plugin needs the tool registry; everything else is optional. */
export const inject = ['tools']

const DEFAULT_CONFIG = {
  tariff: 0.56,
  currency: 'CNY',
  cpuTdp: 125,
  cpuIdle: 12,
  baseWatts: 30,
  psuEfficiency: 0.9,
  intervalMs: 2500,
  enableNvidia: true,
  nvidiaSmiPath: '',
  enableLhm: true,
  lhmUrl: 'http://127.0.0.1:8085/data.json',
  stateFile: '',
  historyPoints: 90,
}

const RPC_PREFIX = 'power-monitor/'
const ROUTE_PATH = '/plugins/dsh-power-monitor/api'
const HISTORY_MAX_MINUTES = 60

function clampNumber(value, fallback, min, max) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function normalizeConfig(raw) {
  const config = raw && typeof raw === 'object' ? raw : {}
  return {
    tariff: clampNumber(config.tariff, DEFAULT_CONFIG.tariff, 0, 100),
    currency: typeof config.currency === 'string' && config.currency ? config.currency : DEFAULT_CONFIG.currency,
    cpuTdp: clampNumber(config.cpuTdp, DEFAULT_CONFIG.cpuTdp, 5, 1000),
    cpuIdle: clampNumber(config.cpuIdle, DEFAULT_CONFIG.cpuIdle, 0, 500),
    baseWatts: clampNumber(config.baseWatts, DEFAULT_CONFIG.baseWatts, 0, 2000),
    psuEfficiency: clampNumber(config.psuEfficiency, DEFAULT_CONFIG.psuEfficiency, 0.3, 1),
    intervalMs: Math.round(clampNumber(config.intervalMs, DEFAULT_CONFIG.intervalMs, 500, 60000)),
    enableNvidia: config.enableNvidia !== false,
    nvidiaSmiPath: typeof config.nvidiaSmiPath === 'string' ? config.nvidiaSmiPath.trim() : '',
    enableLhm: config.enableLhm !== false,
    lhmUrl:
      typeof config.lhmUrl === 'string' && /^https?:\/\//.test(config.lhmUrl)
        ? config.lhmUrl
        : DEFAULT_CONFIG.lhmUrl,
    stateFile: typeof config.stateFile === 'string' ? config.stateFile.trim() : '',
    historyPoints: Math.round(clampNumber(config.historyPoints, DEFAULT_CONFIG.historyPoints, 10, 360)),
  }
}

function defaultStateFile() {
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    return path.join(base, 'dsh-power-monitor', 'state.json')
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'dsh-power-monitor', 'state.json')
  }
  const base = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state')
  return path.join(base, 'dsh-power-monitor', 'state.json')
}

function dayKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function symbolFor(currency) {
  switch (currency) {
    case 'CNY':
      return '¥'
    case 'USD':
      return '$'
    case 'EUR':
      return '€'
    case 'GBP':
      return '£'
    case 'JPY':
      return '¥'
    default:
      return ''
  }
}

/** Small JSON state file: per-day watt-hours plus the user's calibration values. */
class Store {
  constructor(file) {
    this.file = file
    this.days = {}
    this.settings = {}
    this.dirty = false
    this.lastSavedAt = 0
  }

  load() {
    try {
      const text = fs.readFileSync(this.file, 'utf8')
      const data = JSON.parse(text)
      if (data && typeof data === 'object') {
        this.days = data.days && typeof data.days === 'object' && !Array.isArray(data.days) ? data.days : {}
        this.settings = data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings) ? data.settings : {}
      }
    } catch {
      // A missing or corrupt file simply starts a fresh local ledger.
    }
  }

  save(force = false) {
    const now = Date.now()
    if (!force && (!this.dirty || now - this.lastSavedAt < 20000)) return
    this.lastSavedAt = now
    this.dirty = false
    const payload = JSON.stringify({ version: 1, days: this.days, settings: this.settings })
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const temp = `${this.file}.tmp`
      fs.writeFileSync(temp, payload, 'utf8')
      fs.renameSync(temp, this.file)
    } catch {
      // Persistence is best effort; live monitoring must keep working.
    }
  }

  pruneDays(keep = 62) {
    const keys = Object.keys(this.days).sort()
    while (keys.length > keep) delete this.days[keys.shift()]
  }
}

function readCpuTimes() {
  let idle = 0
  let total = 0
  for (const cpu of os.cpus()) {
    const times = cpu.times
    idle += times.idle
    total += times.user + times.nice + times.sys + times.idle + times.irq
  }
  return { idle, total }
}

function cpuLoadFrom(previous, next) {
  if (!previous || !next) return 0
  const totalDelta = next.total - previous.total
  const idleDelta = next.idle - previous.idle
  if (totalDelta <= 0) return 0
  const load = 1 - idleDelta / totalDelta
  return Math.min(1, Math.max(0, load))
}

function parseWatts(value) {
  if (typeof value !== 'string') return null
  const match = /(-?\d+(?:[.,]\d+)?)\s*w\b/i.exec(value)
  if (!match) return null
  const parsed = Number(match[1].replace(',', '.'))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

/**
 * LibreHardwareMonitor exposes a JSON sensor tree at its web server root.
 * Only package-level power sensors are trusted; per-core figures are skipped
 * so one CPU package is never counted twice.
 */
function extractLhmPower(tree) {
  const result = { cpu: null, gpu: null }
  const walk = (node, ancestry) => {
    if (!node || typeof node !== 'object') return
    const text = typeof node.Text === 'string' ? node.Text : ''
    const trail = text ? `${ancestry} ${text}`.trim() : ancestry
    const watts = parseWatts(node.Value)
    if (watts !== null && text) {
      const underGpu = /gpu|nvidia|radeon|graphics/i.test(trail)
      const underCpu = /cpu|processor|ryzen|core i\d|xeon/i.test(trail)
      const packageLevel = /package|total|power/i.test(text) && !/core\s*#|core \d/i.test(text)
      if (packageLevel && underGpu) result.gpu = Math.max(result.gpu ?? 0, watts)
      else if (packageLevel && underCpu) result.cpu = Math.max(result.cpu ?? 0, watts)
    }
    const children = Array.isArray(node.Children) ? node.Children : []
    for (const child of children) walk(child, trail)
  }
  walk(tree, '')
  return result
}

class Monitor {
  constructor(ctx, config) {
    this.ctx = ctx
    this.config = config
    this.store = new Store(config.stateFile || defaultStateFile())
    this.store.load()

    this.settings = {
      tariff: clampNumber(this.store.settings.tariff, config.tariff, 0, 100),
      cpuTdp: clampNumber(this.store.settings.cpuTdp, config.cpuTdp, 5, 1000),
      baseWatts: clampNumber(this.store.settings.baseWatts, config.baseWatts, 0, 2000),
    }

    this.cpuModel = (os.cpus()[0]?.model || '').trim() || 'CPU'
    this.cpuLoad = 0
    this.lastCpu = readCpuTimes()
    this.lastAt = Date.now()
    this.timer = null
    this.busy = false
    this.sessionWh = 0
    this.history = []
    this.power = { cpu: 0, gpu: 0, other: 0, total: 0 }
    this.sources = { cpu: 'estimate', gpu: 'none' }
    this.gpus = []
    this.nvidia = { ok: null, nextTry: 0, error: '' }
    this.nvidiaPath = ''
    this.lhm = { ok: null, nextTry: 0, cpu: null, gpu: null, error: '' }
    this.ready = false
    this.lastError = ''
    this.snapshotCache = null
  }

  start() {
    this.lastCpu = readCpuTimes()
    this.lastAt = Date.now()
    this.timer = setInterval(() => {
      void this.tick()
    }, this.config.intervalMs)
    void this.tick()
    return () => {
      if (this.timer) clearInterval(this.timer)
      this.timer = null
      this.store.save(true)
    }
  }

  async tick() {
    if (this.busy) return
    this.busy = true
    try {
      const now = Date.now()
      const elapsedSeconds = Math.min(30, Math.max(0, (now - this.lastAt) / 1000))
      this.lastAt = now

      const cpuTimes = readCpuTimes()
      this.cpuLoad = cpuLoadFrom(this.lastCpu, cpuTimes)
      this.lastCpu = cpuTimes

      const [nvidia, lhm] = await Promise.all([this.readNvidia(), this.readLhm()])

      const gpuDc = nvidia.power ?? lhm.gpu
      const cpuDc = lhm.cpu ?? this.estimateCpu(this.cpuLoad)
      this.sources = {
        cpu: lhm.cpu !== null && lhm.cpu !== undefined ? 'lhm' : 'estimate',
        gpu: nvidia.power !== null && nvidia.power !== undefined ? 'nvidia-smi' : lhm.gpu != null ? 'lhm' : 'none',
      }
      this.gpus = nvidia.gpus

      const efficiency = this.config.psuEfficiency
      const other = this.settings.baseWatts
      const totalDc = cpuDc + (gpuDc ?? 0) + other
      this.power = {
        cpu: round(cpuDc / efficiency, 1),
        gpu: round((gpuDc ?? 0) / efficiency, 1),
        other: round(other / efficiency, 1),
        total: round(totalDc / efficiency, 1),
      }

      if (elapsedSeconds > 0 && this.power.total > 0) {
        const wh = (this.power.total * elapsedSeconds) / 3600
        this.sessionWh += wh
        const key = dayKey()
        this.store.days[key] = (this.store.days[key] ?? 0) + wh
        this.store.dirty = true
        this.store.pruneDays()
      }

      this.history.push({ t: now, w: this.power.total })
      const maxPoints = Math.max(this.config.historyPoints, Math.round((HISTORY_MAX_MINUTES * 60000) / this.config.intervalMs))
      if (this.history.length > maxPoints) this.history.splice(0, this.history.length - maxPoints)

      this.ready = true
      this.lastError = ''
      this.snapshotCache = null
      this.store.save(false)
    } catch (error) {
      // A single failed sample must not stop the interval.
      this.lastError = error instanceof Error ? error.message : String(error)
    } finally {
      this.busy = false
    }
  }

  estimateCpu(load) {
    const idle = Math.min(this.config.cpuIdle, this.settings.cpuTdp)
    const span = Math.max(0, this.settings.cpuTdp - idle)
    return idle + span * load
  }

  async readNvidia() {
    const empty = { power: null, gpus: this.gpus }
    if (!this.config.enableNvidia) return empty
    const now = Date.now()
    if (this.nvidia.ok === false && now < this.nvidia.nextTry) return empty
    const query = 'name,power.draw,utilization.gpu,temperature.gpu,memory.used,memory.total'
    const candidates = []
    if (this.nvidiaPath) candidates.push(this.nvidiaPath)
    if (this.config.nvidiaSmiPath && !candidates.includes(this.config.nvidiaSmiPath)) {
      candidates.push(this.config.nvidiaSmiPath)
    }
    if (candidates.length === 0) candidates.push('nvidia-smi')
    if (process.platform === 'win32') {
      const legacy = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe')
      if (!candidates.includes(legacy)) candidates.push(legacy)
    }
    let stdout = null
    let failure = ''
    for (const candidate of candidates) {
      const result = await new Promise((resolve) => {
        execFile(
          candidate,
          [`--query-gpu=${query}`, '--format=csv,noheader,nounits'],
          { timeout: 2500, windowsHide: true, maxBuffer: 64 * 1024 },
          (error, output) => resolve({ error, output: String(output || '') }),
        )
      })
      if (!result.error) {
        stdout = result.output
        this.nvidiaPath = candidate
        break
      }
      failure = result.error.message || String(result.error)
    }
    if (stdout === null) {
      this.nvidia = { ok: false, nextTry: now + 60000, error: failure || 'nvidia-smi unavailable' }
      return empty
    }
    const rows = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    if (rows.length === 0) {
      this.nvidia = { ok: false, nextTry: now + 60000, error: 'nvidia-smi returned no GPU' }
      return empty
    }
    let power = 0
    let measured = false
    const gpus = []
    for (const row of rows) {
      const parts = row.split(',').map((part) => part.trim())
      const name = parts[0] || 'GPU'
      const watts = Number.parseFloat(parts[1])
      const utilization = Number.parseFloat(parts[2])
      const temperature = Number.parseFloat(parts[3])
      const memoryUsed = Number.parseFloat(parts[4])
      const memoryTotal = Number.parseFloat(parts[5])
      if (Number.isFinite(watts)) {
        power += watts
        measured = true
      }
      gpus.push({
        name,
        watts: Number.isFinite(watts) ? round(watts, 1) : null,
        utilization: Number.isFinite(utilization) ? utilization : null,
        temperature: Number.isFinite(temperature) ? temperature : null,
        memoryUsedMb: Number.isFinite(memoryUsed) ? memoryUsed : null,
        memoryTotalMb: Number.isFinite(memoryTotal) ? memoryTotal : null,
      })
    }
    this.nvidia = { ok: true, nextTry: 0, error: '' }
    return { power: measured ? power : null, gpus }
  }

  async readLhm() {
    const empty = { cpu: null, gpu: null }
    if (!this.config.enableLhm) return empty
    const now = Date.now()
    if (this.lhm.ok === false && now < this.lhm.nextTry) {
      return { cpu: this.lhm.cpu, gpu: this.lhm.gpu }
    }
    try {
      const response = await fetch(this.config.lhmUrl, {
        signal: AbortSignal.timeout(1500),
        headers: { accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const tree = await response.json()
      const power = extractLhmPower(tree)
      this.lhm = { ok: true, nextTry: 0, cpu: power.cpu, gpu: power.gpu, error: '' }
      return power
    } catch (error) {
      this.lhm = {
        ok: false,
        nextTry: now + 30000,
        cpu: null,
        gpu: null,
        error: error instanceof Error ? error.message : String(error),
      }
      return empty
    }
  }

  energyFor(keyPrefix) {
    let wh = 0
    for (const [date, value] of Object.entries(this.store.days)) {
      if (date.startsWith(keyPrefix) && Number.isFinite(value)) wh += value
    }
    return wh
  }

  snapshot() {
    if (this.snapshotCache) return this.snapshotCache
    const today = dayKey()
    const todayWh = Number.isFinite(this.store.days[today]) ? this.store.days[today] : 0
    const monthWh = this.energyFor(today.slice(0, 7))
    const tariff = this.settings.tariff
    const cost = (wh) => round((wh / 1000) * tariff, 4)
    const snapshot = {
      ready: this.ready,
      ts: Date.now(),
      today,
      watts: { ...this.power },
      sources: { ...this.sources },
      cpu: {
        model: this.cpuModel,
        load: round(this.cpuLoad * 100, 0),
        tdp: this.settings.cpuTdp,
        idle: this.config.cpuIdle,
      },
      gpus: this.gpus,
      energy: {
        sessionWh: round(this.sessionWh, 2),
        todayWh: round(todayWh, 2),
        monthWh: round(monthWh, 2),
      },
      cost: {
        session: cost(this.sessionWh),
        today: cost(todayWh),
        month: cost(monthWh),
      },
      tariff,
      currency: this.config.currency,
      symbol: symbolFor(this.config.currency),
      settings: {
        tariff: this.settings.tariff,
        cpuTdp: this.settings.cpuTdp,
        baseWatts: this.settings.baseWatts,
        psuEfficiency: this.config.psuEfficiency,
        intervalMs: this.config.intervalMs,
      },
      diagnostics: {
        platform: process.platform,
        nvidia: this.nvidia.ok === true,
        nvidiaError: this.nvidia.error,
        lhm: this.lhm.ok === true,
        lhmError: this.lhm.error,
        lhmUrl: this.config.lhmUrl,
        stateFile: this.store.file,
        lastError: this.lastError,
      },
      history: this.history.slice(-this.config.historyPoints),
    }
    this.snapshotCache = snapshot
    return snapshot
  }

  updateSettings(patch) {
    const input = patch && typeof patch === 'object' ? patch : {}
    const next = {
      tariff: clampNumber(input.tariff, this.settings.tariff, 0, 100),
      cpuTdp: clampNumber(input.cpuTdp, this.settings.cpuTdp, 5, 1000),
      baseWatts: clampNumber(input.baseWatts, this.settings.baseWatts, 0, 2000),
    }
    this.settings = next
    this.store.settings = next
    this.store.save(true)
    this.snapshotCache = null
    // Fold the new model into the very next sample instead of waiting a full interval.
    void this.tick()
    return this.snapshot()
  }

  report() {
    const data = this.snapshot()
    const watts = data.watts
    const parts = [`CPU ${watts.cpu.toFixed(1)} W ${data.sources.cpu === 'lhm' ? 'measured' : 'estimated'}`]
    if (data.sources.gpu !== 'none') {
      parts.push(`GPU ${watts.gpu.toFixed(1)} W ${data.sources.gpu === 'nvidia-smi' ? 'measured' : 'measured (LibreHardwareMonitor)'}`)
    }
    parts.push(`other ${watts.other.toFixed(1)} W configured`)
    const money = (value) => `${data.symbol}${value.toFixed(3)}`
    const summary = [
      `Power now: ${watts.total.toFixed(1)} W at the wall (${parts.join(', ')}).`,
      `Energy: today ${(data.energy.todayWh / 1000).toFixed(3)} kWh (${money(data.cost.today)}), this month ${(data.energy.monthWh / 1000).toFixed(3)} kWh (${money(data.cost.month)}), this run ${(data.energy.sessionWh / 1000).toFixed(3)} kWh.`,
      `Tariff ${data.symbol}${data.tariff}/kWh, PSU efficiency ${Math.round(data.settings.psuEfficiency * 100)}%. CPU load ${data.cpu.load}% on ${data.cpu.model}.`,
    ].join(' ')
    return {
      summary,
      watts: watts.total,
      todayKwh: round(data.energy.todayWh / 1000, 3),
      todayCost: data.cost.today,
      monthKwh: round(data.energy.monthWh / 1000, 3),
      monthCost: data.cost.month,
      tariff: data.tariff,
      currency: data.currency,
      sources: { ...data.sources },
    }
  }
}

function readRequestBody(request, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('Request body too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  response.end(payload)
}

function toolDefinition(monitor) {
  return {
    name: 'power_status',
    description:
      "Read this computer's live power draw in watts, the energy it has used today and this month, and the estimated electricity cost. GPU figures come from nvidia-smi, CPU figures from a TDP model unless LibreHardwareMonitor is running.",
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Human-readable report line.' },
          watts: { type: 'number', description: 'Current wall-side power draw in watts.' },
          todayKwh: { type: 'number' },
          todayCost: { type: 'number' },
          monthKwh: { type: 'number' },
          monthCost: { type: 'number' },
          tariff: { type: 'number', description: 'Price per kWh in the configured currency.' },
          currency: { type: 'string' },
          sources: {
            type: 'object',
            properties: {
              cpu: { type: 'string' },
              gpu: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
        required: ['summary'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: String(value?.summary ?? '') }],
    },
    execute: async () => monitor.report(),
  }
}

function registerRpc(ctx, monitor) {
  return ctx.effect(() => {
    const connection = ctx.get('connection')
    const rpc = connection?.rpc
    if (!rpc) return undefined
    const disposers = []
    const handle = async (endpoint, payload) => {
      try {
        if (endpoint === `${RPC_PREFIX}snapshot`) return { ok: true, value: monitor.snapshot() }
        if (endpoint === `${RPC_PREFIX}settings`) return { ok: true, value: monitor.updateSettings(payload) }
        return {
          ok: false,
          error: { code: 'power-monitor/unknown-endpoint', message: `Unknown endpoint: ${endpoint}`, details: {} },
        }
      } catch (error) {
        return {
          ok: false,
          error: {
            code: 'power-monitor/failed',
            message: error instanceof Error ? error.message : String(error),
            details: {},
          },
        }
      }
    }
    try {
      if (typeof rpc.intercept === 'function') {
        disposers.push(rpc.intercept('/api', (endpoint) => endpoint.startsWith(RPC_PREFIX), handle))
      }
    } catch {
      // A carrier without the shared-channel interceptor falls back to a channel of its own.
    }
    try {
      if (typeof rpc.handle === 'function' && disposers.length === 0) {
        disposers.push(rpc.handle('power-monitor', handle))
      }
    } catch {
      // Transport unavailable; the HTTP route below still serves the panel.
    }
    return () => {
      for (const dispose of disposers) {
        try {
          const result = dispose()
          if (result && typeof result.then === 'function') result.catch(() => {})
        } catch {
          // Disposal is best effort.
        }
      }
    }
  }, 'power-monitor: rpc')
}

function registerRoute(ctx, monitor) {
  return ctx.effect(() => {
    const webServer = ctx.get('webServer')
    if (!webServer) return undefined
    const connection = ctx.get('connection')
    const dispose = webServer.register({
      kind: 'exact',
      path: ROUTE_PATH,
      handler: async (request, response) => {
        // The carrier leaves plugin routes to authenticate themselves.
        try {
          const rejection = connection?.requestRejection?.({ headers: request.headers })
          if (rejection) {
            sendJson(response, rejection, { ok: false, error: { code: 'unauthorized', message: 'Unauthorized' } })
            return
          }
        } catch {
          sendJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'Forbidden' } })
          return
        }
        try {
          if (request.method === 'GET') {
            const action = new URL(request.url || '/', 'http://localhost').searchParams.get('action')
            if (action === 'settings') {
              sendJson(response, 200, { ok: true, value: monitor.snapshot() })
              return
            }
            sendJson(response, 200, { ok: true, value: monitor.snapshot() })
            return
          }
          if (request.method === 'POST') {
            const text = await readRequestBody(request)
            const body = text ? JSON.parse(text) : {}
            sendJson(response, 200, { ok: true, value: monitor.updateSettings(body?.patch ?? body) })
            return
          }
          response.writeHead(405, { allow: 'GET, POST' })
          response.end()
        } catch (error) {
          sendJson(response, 400, {
            ok: false,
            error: { code: 'power-monitor/failed', message: error instanceof Error ? error.message : String(error) },
          })
        }
      },
    })
    return dispose
  }, 'power-monitor: http route')
}

export function apply(ctx, config) {
  const monitor = new Monitor(ctx, normalizeConfig(config))
  ctx.effect(() => monitor.start(), 'power-monitor: sampling')
  ctx.effect(() => ctx.tools.register(toolDefinition(monitor)), 'power-monitor: tool')
  ctx.inject(['connection'], () => registerRpc(ctx, monitor))
  ctx.inject(['webServer'], () => registerRoute(ctx, monitor))
}