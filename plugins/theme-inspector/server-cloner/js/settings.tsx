import { Design } from '@valenced/discord/design'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { React, ReactNative } from '@valenced/react'
import {
  DEFAULT_OPTIONS,
  type Options,
  cancel,
  canAdminister,
  listGuilds,
  run,
  runClone,
  subscribe,
  summarize,
} from './cloner'

const h = (...args: any[]) => React.createElement(...args)

export function ServerClonerSettings() {
  const { ScrollView, TextInput, View } = ReactNative
  const { Button, TableRow, TableRowGroup, TableSwitchRow, Text } = Design

  const [, rerender] = React.useReducer((n: number) => n + 1, 0)
  React.useEffect(() => subscribe(rerender), [])

  const [sourceId, setSourceId] = React.useState<string | null>(null)
  const [targetKind, setTargetKind] = React.useState<'new' | 'existing'>('new')
  const [targetId, setTargetId] = React.useState<string | null>(null)
  const [newName, setNewName] = React.useState('')
  const [opts, setOpts] = React.useState<Options>(DEFAULT_OPTIONS)
  const [srcFilter, setSrcFilter] = React.useState('')
  const [dstFilter, setDstFilter] = React.useState('')
  const [confirming, setConfirming] = React.useState(false)

  const guilds = React.useMemo(() => listGuilds(), [])
  const source = guilds.find(g => g.id === sourceId)
  const summary = sourceId ? summarize(sourceId) : null

  const set = (key: keyof Options) => (value: boolean) => {
    setOpts(o => ({ ...o, [key]: value }))
    setConfirming(false)
  }

  const check = (active: boolean) =>
    active ? h(Text, { variant: 'text-sm/semibold', color: 'text-positive' }, '✓') : null

  const match = (name: string, filter: string) =>
    !filter.trim() || name.toLowerCase().includes(filter.trim().toLowerCase())

  const sourceRows = guilds.filter(g => match(g.name, srcFilter)).slice(0, 25)
  const targetRows = guilds
    .filter(g => g.id !== sourceId && canAdminister(g.id) !== false && match(g.name, dstFilter))
    .slice(0, 25)
  const target = guilds.find(g => g.id === targetId)

  const ready =
    !!sourceId &&
    (targetKind === 'new' || !!targetId) &&
    (opts.roles || opts.channels || opts.settings) &&
    !run.running

  const start = () => {
    if (!sourceId) return
    setConfirming(false)
    runClone(
      sourceId,
      targetKind === 'new'
        ? { kind: 'new', name: newName.trim() || `${source?.name ?? 'Server'} (Clone)` }
        : { kind: 'existing', id: targetId as string },
      opts,
    )
  }

  const confirmText =
    summary && source
      ? `Copy ${opts.roles ? `${summary.roles} roles` : 'no roles'}, ${opts.channels ? `${summary.categories} categories and ${summary.channels} channels` : 'no channels'} from "${source.name}" into ${
          targetKind === 'new' ? 'a NEW server' : `"${target?.name ?? '?'}"`
        }.${opts.wipe && targetKind === 'existing' ? ' This will DELETE all channels and removable roles in the target first.' : ''}`
      : ''

  return h(
    ScrollView,
    { style: { flex: 1 }, keyboardShouldPersistTaps: 'handled' },
    h(
      View,
      { style: { padding: 16, gap: 16 } },

      h(Text, { variant: 'text-sm/medium', color: 'text-muted' },
        'Copies structure only: roles, categories, channels and role permission overwrites. Not members, messages, emojis, stickers or bots.'),

      // ── source ────────────────────────────────────────────────────
      h(
        TableRowGroup,
        { title: '1. Source server' },
        h(TextInput, {
          style: { padding: 12, color: '#fff', fontSize: 14 },
          placeholder: 'Search your servers…',
          placeholderTextColor: '#777',
          value: srcFilter,
          onChangeText: setSrcFilter,
          autoCapitalize: 'none',
          autoCorrect: false,
        }),
        guilds.length === 0
          ? h(TableRow, { label: 'No servers found.', subLabel: 'The guild store could not be read.' })
          : sourceRows.map(g =>
              h(TableRow, {
                key: g.id,
                label: g.name,
                trailing: check(g.id === sourceId),
                onPress: () => {
                  setSourceId(g.id)
                  setConfirming(false)
                },
              }),
            ),
      ),

      summary && source
        ? h(
            TableRowGroup,
            { title: `Selected: ${source.name}` },
            h(TableRow, {
              label: `${summary.roles} roles · ${summary.categories} categories · ${summary.channels} channels`,
              subLabel: summary.memberOverwrites
                ? `${summary.memberOverwrites} member-specific overwrites will be skipped. Only channels you can see are counted.`
                : 'Only channels you can see are counted.',
              subLabelLineClamp: 3,
            }),
          )
        : null,

      // ── target ────────────────────────────────────────────────────
      h(
        TableRowGroup,
        { title: '2. Target' },
        h(TableRow, {
          label: 'Create a new server',
          trailing: check(targetKind === 'new'),
          onPress: () => {
            setTargetKind('new')
            setConfirming(false)
          },
        }),
        h(TableRow, {
          label: 'Use an existing server',
          subLabel: 'Only servers where you are the owner or have Administrator.',
          trailing: check(targetKind === 'existing'),
          onPress: () => {
            setTargetKind('existing')
            setConfirming(false)
          },
        }),
      ),

      targetKind === 'new'
        ? h(
            TableRowGroup,
            { title: 'New server name' },
            h(TextInput, {
              style: { padding: 12, color: '#fff', fontSize: 14 },
              placeholder: source ? `${source.name} (Clone)` : 'Server name',
              placeholderTextColor: '#777',
              value: newName,
              onChangeText: setNewName,
            }),
          )
        : h(
            TableRowGroup,
            { title: 'Pick the target server' },
            h(TextInput, {
              style: { padding: 12, color: '#fff', fontSize: 14 },
              placeholder: 'Search…',
              placeholderTextColor: '#777',
              value: dstFilter,
              onChangeText: setDstFilter,
              autoCapitalize: 'none',
              autoCorrect: false,
            }),
            targetRows.length === 0
              ? h(TableRow, { label: 'No eligible servers.' })
              : targetRows.map(g =>
                  h(TableRow, {
                    key: g.id,
                    label: g.name,
                    trailing: check(g.id === targetId),
                    onPress: () => {
                      setTargetId(g.id)
                      setConfirming(false)
                    },
                  }),
                ),
          ),

      // ── options ───────────────────────────────────────────────────
      h(
        TableRowGroup,
        { title: '3. What to copy' },
        h(TableSwitchRow, {
          label: 'Roles',
          subLabel: 'With colors, hoist, mentionable and permissions. In an existing server, same-named roles are updated instead of duplicated.',
          value: opts.roles,
          onValueChange: set('roles'),
        }),
        h(TableSwitchRow, {
          label: 'Categories and channels',
          subLabel: 'In an existing server these are added alongside what is already there.',
          value: opts.channels,
          onValueChange: set('channels'),
        }),
        h(TableSwitchRow, {
          label: 'Permission overwrites',
          subLabel: 'Role overwrites on every channel and category.',
          value: opts.overwrites,
          onValueChange: set('overwrites'),
        }),
        h(TableSwitchRow, {
          label: 'Server settings',
          subLabel: 'Verification level, default notifications, content filter, AFK timeout, locale.',
          value: opts.settings,
          onValueChange: set('settings'),
        }),
        targetKind === 'new'
          ? h(TableSwitchRow, {
              label: 'Copy server icon',
              value: opts.copyIcon,
              onValueChange: set('copyIcon'),
            })
          : h(TableSwitchRow, {
              label: 'Wipe target first',
              subLabel: 'DELETES all channels and removable roles in the target before copying. Cannot be undone.',
              value: opts.wipe,
              onValueChange: set('wipe'),
            }),
      ),

      // ── run ───────────────────────────────────────────────────────
      confirming
        ? h(
            TableRowGroup,
            { title: 'Confirm' },
            h(TableRow, { label: confirmText, subLabelLineClamp: 6 }),
            h(TableRow, {
              label: 'Yes, start cloning',
              trailing: h(Text, { variant: 'text-sm/semibold', color: 'text-danger' }, 'Start'),
              onPress: start,
            }),
            h(TableRow, { label: 'Cancel', onPress: () => setConfirming(false) }),
          )
        : h(Button, {
            text: run.running ? 'Cloning…' : 'Clone',
            variant: 'primary',
            disabled: !ready,
            onPress: () => setConfirming(true),
          }),

      run.running
        ? h(Button, { text: 'Cancel clone', variant: 'destructive', onPress: cancel })
        : null,

      run.log.length
        ? h(
            TableRowGroup,
            { title: `Log (${run.log.length})` },
            h(TableRow, {
              label: run.running ? 'Running…' : 'Finished',
              subLabel: run.log.slice(-30).join('\n'),
              subLabelLineClamp: 40,
            }),
            h(TableRow, {
              label: 'Copy full log',
              onPress: () => Clipboard.setString(run.log.join('\n')),
            }),
          )
        : null,
    ),
  )
}
