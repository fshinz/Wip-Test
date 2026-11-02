import { findRest } from './api'
import { findPermissions } from './cloner'
import { ServerClonerSettings } from './settings'

export default plugin({
  SettingsComponent: ServerClonerSettings,

  start({ cleanup, logger }) {
    cleanup(findRest())
    cleanup(findPermissions())

    logger?.log?.('Server Cloner started')
  },
})