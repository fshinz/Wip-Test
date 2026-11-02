import { Stores } from '@valenced/discord/flux'
import { getModules } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { api, sleep } from './api'

const S = Stores as any

export type GuildInfo = { id: string; name: string; icon?: string | null }

export type Options = {
  roles: boolean
  channels: boolean
  overwrites: boolean
  settings: boolean
  copyIcon: boolean
  wipe: boolean
}

export type Target = { kind: 'new'; name: string } | { kind: 'existing'; id: string }

export const DEFAULT_OPTIONS: Options = {
  roles: true,
  channels: true,
  overwrites: true,
  settings: true,
  copyIcon: true,
  wipe: false,
}

// ── shared run state (read by the settings page) ────────────────────────────

export const run = {
  running: false,
  cancelled: false,
  log: [] as string[],
  resultGuildId: undefined as string | undefined,
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
function log(msg: string) {
  run.log.push(`${new Date().toLocaleTimeString()}  ${msg}`)
  if (run.log.length > 400) run.log.shift()
  emit()
}
export function cancel() {
  run.cancelled = true
  log('Cancelling after the current step…')
}

// ── reading the source server ───────────────────────────────────────────────

const vals = (x: any): any[] => (!x ? [] : Array.isArray(x) ? x : Object.values(x))
const byPos = (a: any, b: any) => (a.position ?? 0) - (b.position ?? 0)

let Permissions: any
export function findPermissions() {
  return getModules(withProps<any>('getChannelPermissions', 'can'), (m: any) => {
    Permissions = m
  })
}

/** true/false when known, undefined when it can't be determined. */
export function canAdminister(guildId: string): boolean | undefined {
  try {
    const g = S.GuildStore?.getGuild?.(guildId)
    if (!g) return undefined
    const me = S.UserStore?.getCurrentUser?.()?.id
    if (me && g.ownerId === me) return true
    if (!Permissions?.can) return undefined
    return !!Permissions.can(1n << 3n, g) // ADMINISTRATOR
  } catch {
    return undefined
  }
}

export function listGuilds(): GuildInfo[] {
  try {
    return vals(S.GuildStore?.getGuilds?.())
      .map((g: any) => ({ id: g.id, name: String(g.name ?? g.id), icon: g.icon }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

function getRoles(guildId: string): any[] {
  let list: any[] = []
  try {
    if (S.GuildRoleStore?.getSortedRoles) list = vals(S.GuildRoleStore.getSortedRoles(guildId))
    else if (S.GuildRoleStore?.getRoles) list = vals(S.GuildRoleStore.getRoles(guildId))
    else list = vals(S.GuildStore?.getRoles?.(guildId))
  } catch {
    /* empty */
  }
  return list.slice().sort(byPos)
}

const SUPPORTED_TYPES = [0, 2, 4, 5, 13, 15, 16]

function getChannels(guildId: string): any[] {
  try {
    const mutable = S.ChannelStore?.getMutableGuildChannelsForGuild?.(guildId)
    const list = mutable ? vals(mutable) : vals(S.ChannelStore?.getChannels?.(guildId))
    return list.filter((c: any) => c && SUPPORTED_TYPES.includes(c.type))
  } catch {
    return []
  }
}

export function summarize(guildId: string) {
  const roles = getRoles(guildId).filter(r => r.id !== guildId && !r.managed)
  const channels = getChannels(guildId)
  let memberOverwrites = 0
  for (const c of channels) {
    for (const ow of vals(c.permissionOverwrites ?? c.permission_overwrites)) {
      if (!(ow.type === 0 || ow.type === 'role')) memberOverwrites++
    }
  }
  return {
    roles: roles.length,
    categories: channels.filter(c => c.type === 4).length,
    channels: channels.filter(c => c.type !== 4).length,
    memberOverwrites,
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

const FALLBACK: Record<number, number> = { 5: 0, 13: 2, 15: 0, 16: 0 }
const TEXT_LIKE = [0, 5, 15, 16]
const VOICE_LIKE = [2, 13]

function roleBody(r: any) {
  return {
    name: r.name,
    permissions: String(r.permissions ?? 0),
    color: r.color ?? 0,
    hoist: !!r.hoist,
    mentionable: !!r.mentionable,
  }
}

function mapOverwrites(
  ch: any,
  roleMap: Map<string, string>,
  stats: { memberSkipped: number; unmapped: number },
) {
  const out: any[] = []
  for (const ow of vals(ch.permissionOverwrites ?? ch.permission_overwrites)) {
    const isRole = ow.type === 0 || ow.type === 'role'
    if (!isRole) {
      stats.memberSkipped++
      continue
    }
    const id = roleMap.get(ow.id)
    if (!id) {
      stats.unmapped++
      continue
    }
    out.push({ id, type: 0, allow: String(ow.allow ?? 0), deny: String(ow.deny ?? 0) })
  }
  return out
}

async function iconDataUri(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url)
    const blob = await res.blob()
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch {
    return undefined
  }
}

async function createChannel(
  targetId: string,
  ch: any,
  parentNewId: string | undefined,
  position: number,
  overwrites: any[],
) {
  const bodyFor = (type: number) => {
    const b: any = { name: ch.name, type, position, permission_overwrites: overwrites }
    if (parentNewId) b.parent_id = parentNewId
    if (TEXT_LIKE.includes(type)) {
      if (ch.topic) b.topic = ch.topic
      const slow = ch.rateLimitPerUser ?? ch.rate_limit_per_user
      if (slow) b.rate_limit_per_user = slow
    }
    if (ch.nsfw) b.nsfw = true
    if (VOICE_LIKE.includes(type)) {
      const limit = ch.userLimit ?? ch.user_limit
      if (limit) b.user_limit = limit
    }
    return b
  }

  const url = `/guilds/${targetId}/channels`
  try {
    return await api('post', url, bodyFor(ch.type))
  } catch (e) {
    const fb = FALLBACK[ch.type]
    if (fb === undefined) throw e
    log(`  ↳ type ${ch.type} not available in target, using ${fb === 0 ? 'text' : 'voice'}`)
    return await api('post', url, bodyFor(fb))
  }
}

// ── the clone ───────────────────────────────────────────────────────────────

export async function runClone(sourceId: string, target: Target, opts: Options) {
  if (run.running) return

  run.running = true
  run.cancelled = false
  run.log = []
  run.resultGuildId = undefined
  emit()

  let fails = 0
  const counts = { roles: 0, categories: 0, channels: 0 }
  const stats = { memberSkipped: 0, unmapped: 0 }

  const step = async <T>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    if (run.cancelled) throw { __cancelled: true }
    try {
      const result = await fn()
      log(`✓ ${label}`)
      await sleep(350)
      return result
    } catch (e: any) {
      fails++
      log(`✗ ${label}: ${e?.message ?? e}`)
      await sleep(350)
      return undefined
    }
  }

  try {
    const src = S.GuildStore?.getGuild?.(sourceId)
    if (!src) throw new Error('Source server not found')

    // 1. target
    let targetId: string
    if (target.kind === 'new') {
      const body: any = { name: target.name || `${src.name} (Clone)` }
      if (opts.copyIcon && src.icon) {
        const uri = await iconDataUri(
          `https://cdn.discordapp.com/icons/${sourceId}/${src.icon}.png?size=256`,
        )
        if (uri) body.icon = uri
        else log('Could not download the icon, continuing without it.')
      }
      log(`Creating new server "${body.name}"…`)
      const created = await api('post', '/guilds', body)
      targetId = created.id
      run.resultGuildId = targetId
      log(`✓ created server ${targetId}`)
      await sleep(800)
    } else {
      targetId = target.id
      log(`Using existing server ${targetId}`)
    }

    // 2. clear channels (new server defaults, or an explicit wipe)
    if (opts.channels && (target.kind === 'new' || opts.wipe)) {
      const existing = vals(await api('get', `/guilds/${targetId}/channels`))
      log(`Removing ${existing.length} existing channel(s)…`)
      for (const c of existing) {
        await step(`delete channel ${c.name}`, () => api('del', `/channels/${c.id}`))
      }
    }

    // 3. roles
    const roleMap = new Map<string, string>()
    roleMap.set(sourceId, targetId) // @everyone shares the server id

    const srcRoles = getRoles(sourceId)
    const everyone = srcRoles.find(r => r.id === sourceId)
    const copyRoles = srcRoles.filter(r => r.id !== sourceId && !r.managed)

    if (opts.roles) {
      const existingByName = new Map<string, any>()

      if (target.kind === 'existing') {
        const targetRoles = vals(await api('get', `/guilds/${targetId}/roles`))
        if (opts.wipe) {
          log('Removing existing roles…')
          for (const r of targetRoles) {
            if (r.id === targetId || r.managed) continue
            await step(`delete role @${r.name}`, () =>
              api('del', `/guilds/${targetId}/roles/${r.id}`),
            )
          }
        } else {
          for (const r of targetRoles) {
            if (r.id !== targetId && !r.managed && !existingByName.has(r.name)) {
              existingByName.set(r.name, r)
            }
          }
        }
      }

      if (everyone) {
        await step('@everyone permissions', () =>
          api('patch', `/guilds/${targetId}/roles/${targetId}`, {
            permissions: String(everyone.permissions ?? 0),
          }),
        )
      }

      const createdRoles: { id: string; position: number }[] = []
      log(`Copying ${copyRoles.length} role(s)…`)

      for (let i = 0; i < copyRoles.length; i++) {
        const r = copyRoles[i]
        const body = roleBody(r)
        const existing = existingByName.get(r.name)

        const res: any = await step(`role @${r.name}${existing ? ' (updated)' : ''}`, () =>
          existing
            ? api('patch', `/guilds/${targetId}/roles/${existing.id}`, body)
            : api('post', `/guilds/${targetId}/roles`, body),
        )

        if (res?.id) {
          roleMap.set(r.id, res.id)
          createdRoles.push({ id: res.id, position: i + 1 })
          counts.roles++
        }
      }

      if (createdRoles.length > 1 && (target.kind === 'new' || opts.wipe)) {
        await step('role order', () =>
          api('patch', `/guilds/${targetId}/roles`, createdRoles),
        )
      } else if (createdRoles.length > 1) {
        log('Role order left unchanged in the existing server.')
      }
    } else if (target.kind === 'existing' && opts.overwrites) {
      // Not copying roles: map overwrites onto same-named roles already in the target.
      const targetRoles = vals(await api('get', `/guilds/${targetId}/roles`))
      for (const r of copyRoles) {
        const match = targetRoles.find((t: any) => t.name === r.name && !t.managed)
        if (match) roleMap.set(r.id, match.id)
      }
    }

    // 4. categories and channels
    if (opts.channels) {
      const chans = getChannels(sourceId)
      const cats = chans.filter(c => c.type === 4).sort(byPos)
      const others = chans.filter(c => c.type !== 4)
      const catMap = new Map<string, string>()

      const overwritesFor = (ch: any) =>
        opts.overwrites ? mapOverwrites(ch, roleMap, stats) : []

      log(`Copying ${cats.length} categor${cats.length === 1 ? 'y' : 'ies'} and ${others.length} channel(s)…`)

      for (let i = 0; i < cats.length; i++) {
        const cat = cats[i]
        const res: any = await step(`category ${cat.name}`, () =>
          api('post', `/guilds/${targetId}/channels`, {
            name: cat.name,
            type: 4,
            position: i,
            permission_overwrites: overwritesFor(cat),
          }),
        )
        if (res?.id) {
          catMap.set(cat.id, res.id)
          counts.categories++
        }
      }

      const parentOf = (c: any) => c.parent_id ?? c.parentId ?? null
      const order = (a: any, b: any) => {
        const av = VOICE_LIKE.includes(a.type) ? 1 : 0
        const bv = VOICE_LIKE.includes(b.type) ? 1 : 0
        return av !== bv ? av - bv : byPos(a, b)
      }

      const groups: { parent?: string; items: any[] }[] = []
      for (const cat of cats) {
        groups.push({
          parent: catMap.get(cat.id),
          items: others.filter(c => parentOf(c) === cat.id).sort(order),
        })
      }
      groups.push({ parent: undefined, items: others.filter(c => !parentOf(c)).sort(order) })

      for (const group of groups) {
        for (let i = 0; i < group.items.length; i++) {
          const ch = group.items[i]
          const res: any = await step(`#${ch.name}`, () =>
            createChannel(targetId, ch, group.parent, i, overwritesFor(ch)),
          )
          if (res?.id) counts.channels++
        }
      }
    }

    // 5. server settings
    if (opts.settings) {
      const body: any = {
        verification_level: src.verificationLevel,
        default_message_notifications: src.defaultMessageNotifications,
        explicit_content_filter: src.explicitContentFilter,
        afk_timeout: src.afkTimeout,
        preferred_locale: src.preferredLocale,
      }
      for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k]
      if (Object.keys(body).length) {
        await step('server settings', () => api('patch', `/guilds/${targetId}`, body))
      }
    }

    log(
      `Done. Roles ${counts.roles}, categories ${counts.categories}, channels ${counts.channels}, ` +
        `failures ${fails}, member overwrites skipped ${stats.memberSkipped}, ` +
        `overwrites for unmapped roles skipped ${stats.unmapped}.`,
    )
  } catch (e: any) {
    if (e?.__cancelled) log('Cancelled.')
    else log(`Stopped: ${e?.message ?? e}`)
  } finally {
    run.running = false
    emit()
  }
}
