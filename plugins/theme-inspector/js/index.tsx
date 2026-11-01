import { findJsxRuntime, shutdown } from './inspect'
import { ThemeInspectorSettings } from './settings'
import { findTokens } from './tokens'

export default plugin({
  SettingsComponent: ThemeInspectorSettings,

  start({ cleanup, logger }) {
    cleanup(findTokens())
    cleanup(findJsxRuntime())
    cleanup(shutdown)

    logger?.log?.('Theme Inspector started')
  },
})
