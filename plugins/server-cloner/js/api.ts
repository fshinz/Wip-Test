import { getModules } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'

let rest: any

/** Finds Discord's own REST client (the one the app uses for every API call). */
export function findRest() {
  return getModules(withProps<any>('getAPIBaseURL', 'get', 'post'), (m: any) => {
    rest = m?.default?.get ? m.default : m
  })
}

export const restReady = () => !!rest

export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

type Method = 'get' | 'post' | 'patch' | 'put' | 'del'

/** Calls the Discord API, waiting and retrying when rate limited. */
export async function api<T = any>(method: Method, url: string, body?: unknown): Promise<T> {
  if (!rest) throw new Error('Discord REST module not found')

  const fn = method === 'del' ? (rest.del ?? rest.delete) : rest[method]
  if (typeof fn !== 'function') throw new Error(`REST method "${method}" is missing`)

  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fn.call(rest, body === undefined ? { url } : { url, body })
      return (res && typeof res === 'object' && 'body' in res ? res.body : res) as T
    } catch (e: any) {
      const status = e?.status ?? e?.statusCode
      if (status === 429) {
        const retry = Number(e?.body?.retry_after ?? e?.retry_after ?? 2)
        await sleep(Math.ceil(retry * 1000) + 250)
        continue
      }
      const msg = e?.body?.message ?? e?.message ?? e?.text ?? String(e)
      throw new Error(`${method.toUpperCase()} ${url} → ${status ?? '?'}: ${msg}`)
    }
  }

  throw new Error(`${method.toUpperCase()} ${url} → rate limited repeatedly`)
}
