import { Design } from '@valenced/discord/design'
import { useState } from 'react'

async function check(token: string): Promise<string> {
  try {
    const r = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: token.trim() },
    })
    if (r.status === 200) return `✅ Valid (${(await r.json()).username})`
    if (r.status === 401) return '❌ Invalid or revoked'
    if (r.status === 429) return '⏳ Rate limited, wait a bit'
    return `❓ Unknown (${r.status})`
  } catch {
    return '⚠️ Network error'
  }
}

export default plugin({
  SettingsComponent() {
    const { TableRowGroup, TextInput, Button } = Design
    const [token, setToken] = useState('')
    const [result, setResult] = useState('')

    return (
      <TableRowGroup>
        <TextInput
          label="Token"
          secureTextEntry
          value={token}
          onChange={setToken}
          placeholder="Paste token"
        />
        <Button
          text="Check"
          onPress={async () => {
            setResult('Checking...')
            setResult(await check(token))
            setToken('') // wipe it after checking
          }}
        />
        {result ? <Design.Text>{result}</Design.Text> : null}
      </TableRowGroup>
    )
  },
})
