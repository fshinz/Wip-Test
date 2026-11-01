import { ToastActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { React, ReactNative } from '@valenced/react'
import { lookupGeneratedIconComponent } from '@valenced/utils/discord'
import {
  clearHistory,
  inspectState,
  reportSummary,
  reportToText,
  setCopyOnTap,
  setInspecting,
  setShowButton,
  subscribe,
} from './inspect'
import { forceRootUpdate } from './overlay'
import { probeMounts } from './probe'
import { currentTheme, getMaps, tokensAvailable } from './tokens'

const h = (...args: any[]) => React.createElement(...args)

function Swatch({ color }: { color?: string }) {
  const { View } = ReactNative
  if (!color) return null
  return h(View, {
    style: {
      width: 22,
      height: 22,
      borderRadius: 5,
      backgroundColor: color,
      borderWidth: 1,
      borderColor: '#88888866',
    },
  })
}

function refreshOverlay() {
  forceRootUpdate()
  try {
    ToastActionCreators.open('theme-inspector-refresh', {
      text: 'Theme Inspector: refreshing floating button',
      IconComponent: lookupGeneratedIconComponent(
        'CopyIcon',
        'CopyIcon-secondary',
        'CopyIcon-primary',
      ),
    })
  } catch (e) {
    inspectState.status.refresh = `toast failed: ${String(e)}`
  }
}

function ElementMode() {
  const { Button, TableRow, TableRowGroup, TableSwitchRow, Text } = Design
  const { View } = ReactNative
  const [expanded, setExpanded] = React.useState<number | null>(null)

  const history = inspectState.history
  const status = Object.entries(inspectState.status)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')

  return h(
    View,
    { style: { gap: 16 } },

    h(
      TableRowGroup,
      { title: 'Element inspector' },
      h(TableSwitchRow, {
        label: 'Inspect mode',
        subLabel:
          'Tap any element to see its colors. Only elements rendered after turning this on are inspectable, so open a screen or switch channels afterwards.',
        value: inspectState.enabled,
        onValueChange: setInspecting,
      }),
      h(TableSwitchRow, {
        label: 'Copy report on tap',
        subLabel: 'Copies the report to the clipboard whenever you tap an element.',
        value: inspectState.copyOnTap,
        onValueChange: setCopyOnTap,
      }),
      h(TableSwitchRow, {
        label: 'Floating button',
        subLabel: 'Show the draggable TI button for quick access from any screen.',
        value: inspectState.showButton,
        onValueChange: setShowButton,
      }),
      h(TableRow, {
        label: 'Refresh floating button',
        subLabel: 'Forces the root to re-render and opens a test toast.',
        onPress: refreshOverlay,
      }),
      h(TableRow, {
        label: 'Probe mount points',
        subLabel: 'Checks which known app components exist. Wait 4 seconds, then read Status.',
        onPress: probeMounts,
      }),
      h(TableRow, {
        label: 'Status',
        subLabel: status || 'No status yet.',
        subLabelLineClamp: 10,
      }),
    ),

    history.length
      ? h(Button, { text: 'Clear history', variant: 'destructive', onPress: clearHistory })
      : null,

    h(
      TableRowGroup,
      { title: `Inspected elements (${history.length})` },
      history.length === 0
        ? h(TableRow, {
            label: 'Nothing inspected yet.',
            subLabel: 'Turn on Inspect mode, leave this page, and tap something.',
          })
        : history.map(r =>
            h(TableRow, {
              key: r.id,
              label: r.layers[0]?.component ?? 'Unknown',
              subLabel: expanded === r.id ? reportToText(r) : reportSummary(r),
              subLabelLineClamp: expanded === r.id ? 60 : 2,
              onPress: () => setExpanded(expanded === r.id ? null : r.id),
              trailing:
                expanded === r.id
                  ? h(
                      Text,
                      {
                        variant: 'text-sm/semibold',
                        color: 'text-link',
                        onPress: () => Clipboard.setString(reportToText(r)),
                      },
                      'Copy',
                    )
                  : null,
            }),
          ),
    ),
  )
}

function TokenMode() {
  const { TableRow, TableRowGroup, Text } = Design
  const { TextInput, View } = ReactNative

  const [query, setQuery] = React.useState('')
  const [open, setOpen] = React.useState<string | null>(null)
  const [showRaw, setShowRaw] = React.useState(false)

  if (!tokensAvailable()) {
    return h(
      TableRowGroup,
      { title: 'Token browser' },
      h(TableRow, {
        label: 'Token module not found.',
        subLabel: 'Discord’s color token module could not be located in this build.',
      }),
    )
  }

  const maps = getMaps()
  const source = showRaw ? maps.raw : maps.semantic
  const q = query.trim().toLowerCase()

  const rows = Array.from(source.entries())
    .filter(([name, value]) => !q || name.toLowerCase().includes(q) || value.includes(q))
    .slice(0, 80)

  return h(
    View,
    { style: { gap: 16 } },

    h(
      TableRowGroup,
      { title: `Token browser · theme: ${currentTheme()}` },
      h(TextInput, {
        style: { padding: 12, color: '#fff', fontSize: 14 },
        placeholder: 'Search by token name or hex value…',
        placeholderTextColor: '#777',
        value: query,
        onChangeText: setQuery,
        autoCapitalize: 'none',
        autoCorrect: false,
        spellCheck: false,
      }),
      h(TableRow, {
        label: showRaw ? 'Showing raw tokens' : 'Showing semantic tokens',
        subLabel: `${maps.semantic.size} semantic · ${maps.raw.size} raw. Tap to switch.`,
        onPress: () => {
          setShowRaw(v => !v)
          setOpen(null)
        },
      }),
    ),

    h(
      TableRowGroup,
      { title: `${rows.length} shown${rows.length === 80 ? ' (narrow the search for more)' : ''}` },
      rows.map(([name, value]) => {
        const b = maps.byValue.get(value)
        const same = [
          ...(b?.semantic ?? []).filter(n => n !== name),
          ...(b?.raw ?? []).filter(n => n !== name),
        ]
        return h(TableRow, {
          key: name,
          label: name,
          subLabel:
            open === name
              ? `Value: ${value}\n${same.length ? `Same value: ${same.slice(0, 12).join(', ')}` : 'No other token has this value.'}`
              : value,
          subLabelLineClamp: open === name ? 12 : 1,
          onPress: () => setOpen(open === name ? null : name),
          trailing: h(
            View,
            { style: { flexDirection: 'row', alignItems: 'center', gap: 10 } },
            open === name
              ? h(
                  Text,
                  {
                    variant: 'text-sm/semibold',
                    color: 'text-link',
                    onPress: () => Clipboard.setString(`${name}: ${value}`),
                  },
                  'Copy',
                )
              : null,
            h(Swatch, { color: value }),
          ),
        })
      }),
    ),
  )
}

export function ThemeInspectorSettings() {
  const { ScrollView, View } = ReactNative
  const { TableRow, TableRowGroup, Text } = Design

  const [, rerender] = React.useReducer((n: number) => n + 1, 0)
  const [mode, setMode] = React.useState<'element' | 'token'>('element')

  React.useEffect(() => subscribe(rerender), [])

  const check = (active: boolean) =>
    active ? h(Text, { variant: 'text-sm/semibold', color: 'text-positive' }, '✓') : null

  return h(
    ScrollView,
    { style: { flex: 1 }, keyboardShouldPersistTaps: 'handled' },
    h(
      View,
      { style: { padding: 16, gap: 16 } },
      h(
        TableRowGroup,
        { title: 'Theme Inspector' },
        h(TableRow, {
          label: 'Element mode',
          subLabel: 'Tap a UI element to see where its colors come from.',
          trailing: check(mode === 'element'),
          onPress: () => setMode('element'),
        }),
        h(TableRow, {
          label: 'Token mode',
          subLabel: 'Browse and search every semantic and raw color token.',
          trailing: check(mode === 'token'),
          onPress: () => setMode('token'),
        }),
      ),
      mode === 'element' ? h(ElementMode, null) : h(TokenMode, null),
    ),
  )
}