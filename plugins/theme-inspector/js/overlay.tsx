import { AlertActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { getModules } from '@valenced/modules/finders'
import { withName } from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'
import { React, ReactNative } from '@valenced/react'
import {
  inspectState,
  markMenuClosed,
  markMenuOpen,
  reportSummary,
  reportToText,
  setInspecting,
  setShowButton,
  startMode,
  subscribe,
  suppressBatch,
} from './inspect'

const h = (...args: any[]) => React.createElement(...args)

const SIZE = 46
const fabPos = { x: -1, y: 140 }

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}\n…(use Copy last result for the rest)` : s
}

export function openMenu() {
  const { AlertModal, AlertActionButton, Text } = Design
  const last = inspectState.history[0]
  const on = inspectState.enabled
  const mode = inspectState.mode

  const status = on
    ? `Inspecting: ${mode === 'element' ? 'Element mode' : 'Token mode'}. Tap any element, then open this menu to see the result.`
    : 'Inspecting is off. Pick a mode, then tap any element.'

  const body = [
    status,
    '',
    last ? `Last: ${reportSummary(last)}\n\n${truncate(reportToText(last), 600)}` : 'Nothing inspected yet.',
  ].join('\n')

  const done = (fn?: () => void) => () => {
    markMenuClosed()
    fn?.()
  }

  markMenuOpen()

  try {
    AlertActionCreators.openAlert(
      'theme-inspector-menu',
      h(AlertModal, {
        title: 'Theme Inspector',
        content: h(Text, { variant: 'text-md/normal', selectable: true }, body),
        actions: h(
          React.Fragment,
          null,
          h(AlertActionButton, {
            text: `Element mode${on && mode === 'element' ? '  ✓' : ''}`,
            variant: 'primary',
            onPress: done(() => startMode('element')),
          }),
          h(AlertActionButton, {
            text: `Token mode${on && mode === 'token' ? '  ✓' : ''}`,
            variant: 'primary',
            onPress: done(() => startMode('token')),
          }),
          on
            ? h(AlertActionButton, {
                text: 'Turn inspecting off',
                variant: 'secondary',
                onPress: done(() => setInspecting(false)),
              })
            : null,
          last
            ? h(AlertActionButton, {
                text: 'Copy last result',
                variant: 'secondary',
                onPress: done(() => Clipboard.setString(reportToText(last))),
              })
            : null,
          h(AlertActionButton, {
            text: 'Hide button',
            variant: 'secondary',
            onPress: done(() => setShowButton(false)),
          }),
          h(AlertActionButton, {
            text: 'Close',
            variant: 'secondary',
            onPress: done(),
          }),
        ),
      }),
    )
  } catch (e) {
    markMenuClosed()
    inspectState.status.menu = `failed: ${String(e)}`
  }
}

function FloatingButton() {
  const { Dimensions, PanResponder, Pressable, View } = ReactNative
  const { Text } = Design

  const [, rerender] = React.useReducer((n: number) => n + 1, 0)
  const start = React.useRef({ x: 0, y: 0 })

  React.useEffect(() => subscribe(rerender), [])

  const pan = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_: any, g: any) =>
          Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6,
        onPanResponderGrant: () => {
          start.current = { x: fabPos.x, y: fabPos.y }
        },
        onPanResponderMove: (_: any, g: any) => {
          const { width, height } = Dimensions.get('window')
          fabPos.x = clamp(start.current.x + g.dx, 0, width - SIZE)
          fabPos.y = clamp(start.current.y + g.dy, 0, height - SIZE)
          rerender()
        },
      }),
    [],
  )

  if (!inspectState.showButton) return null

  if (fabPos.x < 0) fabPos.x = Dimensions.get('window').width - SIZE - 12

  // grey = off, green = element mode, blue = token mode
  const color = !inspectState.enabled
    ? '#4e5058'
    : inspectState.mode === 'token'
      ? '#5865F2'
      : '#23a55a'

  return h(
    View,
    {
      ...pan.panHandlers,
      // Runs after the inner elements' handlers, so it can discard the tap on itself.
      onTouchStart: suppressBatch,
      style: {
        position: 'absolute',
        left: fabPos.x,
        top: fabPos.y,
        width: SIZE,
        height: SIZE,
        borderRadius: SIZE / 2,
        zIndex: 9999,
        elevation: 12,
        backgroundColor: color,
        borderWidth: 2,
        borderColor: '#ffffff55',
      },
    },
    h(
      Pressable,
      {
        onPress: openMenu,
        style: {
          width: SIZE - 4,
          height: SIZE - 4,
          alignItems: 'center',
          justifyContent: 'center',
        },
      },
      h(Text, { variant: 'text-sm/semibold', style: { color: '#ffffff' } }, 'TI'),
    ),
  )
}

/** Appends the floating button to Discord's always-mounted ToastContainer. */
export function attachOverlay(cleanup: (fn: any) => void) {
  inspectState.status.overlay = 'waiting for ToastContainer'

  cleanup(
    getModules(
      withName<any>('ToastContainer'),
      (ns: any) => {
        const key =
          typeof ns?.default === 'function'
            ? 'default'
            : typeof ns?.ToastContainer === 'function'
              ? 'ToastContainer'
              : undefined

        if (!key) {
          inspectState.status.overlay = 'ToastContainer has no patchable export'
          return
        }

        cleanup(
          instead(ns, key, (args: any, original: any) => {
            const ret = original.apply(null, args)
            try {
              return h(
                React.Fragment,
                null,
                ret,
                h(FloatingButton, { key: 'theme-inspector-fab' }),
              )
            } catch {
              return ret
            }
          }),
        )

        inspectState.status.overlay = 'attached (reload if the button is missing)'
      },
      { returnNamespace: true },
    ),
  )
}