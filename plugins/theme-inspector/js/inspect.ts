import { ToastActionCreators } from '@valenced/discord/actions'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { getModules } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { before } from '@valenced/patcher'
import { React, ReactNative } from '@valenced/react'
import { lookupGeneratedIconComponent } from '@valenced/utils/discord'
import { type Analysis, analyzeColor, currentTheme } from './tokens'

export type ColorHit = { prop: string } & Analysis
export type Layer = { component: string; hint?: string; colors: ColorHit[] }
export type Report = { id: number; ts: number; theme: string; layers: Layer[] }

export const inspectState = {
  enabled: false,
  copyOnTap: true,
  history: [] as Report[],
  status: {} as Record<string, string>,
}

const listeners = new Set<() => void>()
export function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
function emit() {
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      /* ignore */
    }
  }
}

const STYLE_KEYS = [
  'backgroundColor', 'color', 'borderColor', 'borderTopColor', 'borderBottomColor',
  'borderLeftColor', 'borderRightColor', 'borderStartColor', 'borderEndColor',
  'tintColor', 'shadowColor', 'textDecorationColor', 'overlayColor', 'textShadowColor',
]
const PROP_KEYS = ['color', 'fill', 'stroke', 'tintColor', 'backgroundColor']

function typeName(type: any): string | undefined {
  if (typeof type === 'string') return type
  if (typeof type === 'function') return type.displayName || type.name || 'Anonymous'
  if (type && typeof type === 'object') {
    return (
      type.displayName ||
      type.render?.displayName ||
      type.render?.name ||
      type.type?.displayName ||
      type.type?.name ||
      'Component'
    )
  }
}

function readColors(props: any): [string, unknown][] {
  const out: [string, unknown][] = []

  let style = props.style
  if (style) {
    try {
      style = ReactNative.StyleSheet.flatten(style)
    } catch {
      /* keep as is */
    }
    if (style && typeof style === 'object') {
      for (const k of STYLE_KEYS) {
        const v = style[k]
        if (v != null && v !== 'transparent') out.push([`style.${k}`, v])
      }
    }
  }

  for (const k of PROP_KEYS) {
    const v = props[k]
    if (typeof v === 'string' && v !== 'transparent') out.push([k, v])
  }

  return out
}

// ── tap handling ────────────────────────────────────────────────────────────

type RawLayer = { name: string; entries: [string, unknown][]; hint?: string }
let batch: RawLayer[] | null = null
let reportId = 0

function onTap(name: string, entries: [string, unknown][], props: any) {
  const hint = props.testID || props.nativeID || props.accessibilityLabel
  if (!batch) {
    batch = []
    // Touch events bubble synchronously, so everything under the finger lands in one batch.
    setTimeout(flush, 0)
  }
  batch.push({ name, entries, hint: typeof hint === 'string' ? hint : undefined })
}

function flush() {
  const raw = batch
  batch = null
  if (!raw || !raw.length) return

  const seen = new Set<string>()
  const layers: Layer[] = []

  for (const l of raw) {
    const colors = l.entries.map(([prop, value]) => ({ prop, ...analyzeColor(value) }))
    const sig = `${l.name}|${colors.map(c => `${c.prop}:${c.input}`).join(',')}`
    if (seen.has(sig)) continue
    seen.add(sig)
    layers.push({ component: l.name, hint: l.hint, colors })
    if (layers.length >= 6) break
  }

  const report: Report = { id: reportId++, ts: Date.now(), theme: currentTheme(), layers }
  inspectState.history = [report, ...inspectState.history].slice(0, 50)

  if (inspectState.copyOnTap) Clipboard.setString(reportToText(report))

  try {
    ToastActionCreators.open({
      key: 'theme-inspector',
      content: reportSummary(report),
      IconComponent: lookupGeneratedIconComponent(
        'CopyIcon',
        'CopyIcon-secondary',
        'CopyIcon-primary',
      ),
    })
  } catch {
    /* toast is best-effort */
  }

  emit()
}

// ── formatting ──────────────────────────────────────────────────────────────

export function tokenLabel(c: Analysis) {
  if (c.semantic) return c.semantic
  if (c.raw) return c.raw
  if (c.semanticMatches.length) return `≈ ${c.semanticMatches[0]}`
  if (c.rawMatches.length) return `≈ ${c.rawMatches[0]}`
  return 'no token match'
}

export function reportSummary(r: Report) {
  const l = r.layers[0]
  const c = l?.colors[0]
  if (!l || !c) return 'No colors found'
  return `${l.component} · ${c.prop.replace('style.', '')} → ${tokenLabel(c)}${c.value ? ` (${c.value})` : ''}`
}

export function reportToText(r: Report) {
  const lines = [`Theme: ${r.theme}`]
  for (const l of r.layers) {
    lines.push('', `Element: ${l.component}${l.hint ? ` (${l.hint})` : ''}`)
    for (const c of l.colors) {
      lines.push(`  Property: ${c.prop}`)
      lines.push(`    Value: ${c.value ?? c.input}`)
      if (c.semantic) lines.push(`    Semantic token: ${c.semantic}  [exact]`)
      if (c.raw) lines.push(`    Raw token: ${c.raw}  [exact]`)
      if (c.semanticMatches.length) {
        lines.push(`    Semantic tokens with same value: ${c.semanticMatches.join(', ')}`)
      }
      if (c.rawMatches.length) {
        lines.push(`    Raw tokens with same value: ${c.rawMatches.join(', ')}`)
      }
    }
  }
  return lines.join('\n')
}

// ── patching ────────────────────────────────────────────────────────────────

function augment(type: any, props: any) {
  if (!props || typeof props !== 'object' || typeof type === 'symbol') return
  const entries = readColors(props)
  if (!entries.length) return

  const name = typeName(type) ?? 'Unknown'
  const prev = props.onTouchStart

  return {
    ...props,
    onTouchStart(e: any) {
      try {
        onTap(name, entries, props)
      } catch {
        /* never break the app's own touch handling */
      }
      return typeof prev === 'function' ? prev(e) : undefined
    },
  }
}

// Used for both createElement(type, props, ...children) and jsx(type, props, key).
function rewrite(args: any) {
  try {
    const next = augment(args[0], args[1])
    if (!next) return args
    return [args[0], next].concat(Array.prototype.slice.call(args, 2))
  } catch {
    return args
  }
}

const jsxModules: any[] = []
const unpatches: (() => void)[] = []

export function findJsxRuntime() {
  return getModules(withProps<any>('jsx', 'jsxs'), (m: any) => {
    jsxModules.push(m)
  })
}

function install() {
  inspectState.status = {}

  try {
    unpatches.push(before(React as any, 'createElement', rewrite as any))
    inspectState.status.createElement = 'patched'
  } catch (e) {
    inspectState.status.createElement = `failed: ${String(e)}`
  }

  let n = 0
  for (const m of jsxModules) {
    for (const key of ['jsx', 'jsxs', 'jsxDEV']) {
      if (typeof m?.[key] !== 'function') continue
      try {
        unpatches.push(before(m, key, rewrite as any))
        n++
      } catch {
        /* namespace may be frozen */
      }
    }
  }
  inspectState.status.jsx = n ? `${n} patched` : 'not patched'
}

function uninstall() {
  for (const u of unpatches.splice(0)) {
    try {
      u()
    } catch {
      /* ignore */
    }
  }
}

export function setInspecting(on: boolean) {
  if (on === inspectState.enabled) return
  inspectState.enabled = on
  if (on) install()
  else uninstall()
  emit()
}

export function setCopyOnTap(on: boolean) {
  inspectState.copyOnTap = on
  emit()
}

export function clearHistory() {
  inspectState.history = []
  emit()
}

export function shutdown() {
  setInspecting(false)
}
