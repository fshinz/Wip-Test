import { Design } from '@valenced/discord/design'
import { useState } from 'react'

const NITRO = ['None', 'Nitro Classic', 'Nitro', 'Nitro Basic']

function createdAt(id: string) {
  const ms = Number(BigInt(id) >> 22n) + 1420070400000
  return new Date(ms).toLocaleDateString()
}

async function check(token: string): Promise<string> {
  try {
    const r = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: token.trim() },
    })
    if (r.status === 401) return '❌ Invalid or revoked'
    if (r.status === 429) return '⏳ Rate limited, wait a bit'
    if (r.status === 403) return '🔒 Locked or needs verification'
    if (r.status !== 200) return `❓ Unknown (${r.status})`

    const u = await r.json()
    return [
      '✅ Valid',
      `Username: ${u.username}`,
      `Display name: ${u.global_name ?? 'none'}`,
      `ID: ${u.id}`,
      `Created: ${createdAt(u.id)}`,
      `Email: ${u.email ?? 'none'} ${u.verified ? '(verified)' : '(unverified)'}`,
      `Phone: ${u.phone ?? 'none'}`,
      `2FA: ${u.mfa_enabled ? 'on' : 'off'}`,
      `Nitro: ${NITRO[u.premium_type ?? 0] ?? 'unknown'}`,
    ].join('\n')
  } catch {
    return '⚠️ Network error'
  }
}

export default function Settings() {
  const { TableRowGroup, TextInput, Button, Text } = Design
  const [token, setToken] = useState('')
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (!token.trim() || busy) return
    setBusy(true)
    setResult('Checking...')
    setResult(await check(token))
    setToken('') // wipe the token after checking
    setBusy(false)
  }

  return (
    <TableRowGroup title="Token Checker">
      <TextInput
        label="Token"
        placeholder="Paste your token"
        value={token}
        onChange={setToken}
        secureTextEntry
      />
      <Button text={busy ? 'Checking...' : 'Check token'} onPress={run} />
      {result ? <Text selectable>{result}</Text> : null}
    </TableRowGroup>
  )
}