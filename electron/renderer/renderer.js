const shell = window.loiterlyShell

function createAppState(id, title, options = {}) {
  return {
    id,
    title,
    url: '',
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
    showAddressBar: false,
    showNavigation: false,
    ...options,
  }
}

const state = {
  activeApp: 'browser',
  apps: {
    browser: createAppState('browser', 'Loiterly Browser', {
      showAddressBar: true,
      showNavigation: true,
    }),
    notion: createAppState('notion', 'Notion'),
    github: createAppState('github', 'GitHub'),
    links: createAppState('links', 'Links'),
    conductor: createAppState('conductor', 'Conductor'),
  },
  globalShortcut: 'CommandOrControl+Shift+L',
}

const elements = {
  tiles: Array.from(document.querySelectorAll('.tile')),
  tileBadges: Array.from(document.querySelectorAll('.tile-badge')),
  contentHost: document.getElementById('content-host'),
  addressForm: document.getElementById('address-form'),
  addressInput: document.getElementById('address-input'),
  navControls: document.querySelector('.nav-controls'),
  pageTitle: document.getElementById('page-title'),
  pageStatus: document.getElementById('page-status'),
  goBack: document.getElementById('go-back'),
  goForward: document.getElementById('go-forward'),
  reload: document.getElementById('reload'),
  hideWindow: document.getElementById('hide-window'),
  globalShortcut: document.getElementById('global-shortcut'),
  main: document.querySelector('.main'),
  toolbar: document.querySelector('.toolbar'),
}

function formatShortcut(shortcut) {
  const isMac = navigator.platform.toUpperCase().includes('MAC')
  const symbolMap = {
    CommandOrControl: isMac ? '⌘' : 'Ctrl',
    Command: '⌘',
    Control: isMac ? '⌃' : 'Ctrl',
    Ctrl: isMac ? '⌃' : 'Ctrl',
    Shift: '⇧',
    Alt: isMac ? '⌥' : 'Alt',
    Option: '⌥',
  }

  return shortcut
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => symbolMap[part] || part.toUpperCase())
}

function render() {
  const currentApp = state.apps[state.activeApp] || createAppState(state.activeApp, state.activeApp)
  const showBrowserControls = currentApp.showAddressBar || currentApp.showNavigation

  elements.tiles.forEach((tile) => {
    tile.classList.toggle('is-active', tile.dataset.app === state.activeApp)
  })

  elements.tileBadges.forEach((badge) => {
    const appId = badge.dataset.badgeFor
    const badgeCount = state.apps[appId]?.unreadCount || 0
    if (badgeCount < 1) {
      badge.hidden = true
      badge.textContent = ''
      return
    }

    badge.hidden = false
    badge.textContent = badgeCount > 9 ? '9+' : `${badgeCount}`
  })

  elements.main.classList.toggle('is-app-mode', !showBrowserControls)
  elements.toolbar.classList.toggle('is-app-mode', !showBrowserControls)
  elements.addressForm.hidden = !currentApp.showAddressBar
  elements.navControls.hidden = !currentApp.showNavigation

  if (currentApp.showAddressBar) {
    elements.addressInput.removeAttribute('disabled')
    elements.addressInput.value = currentApp.url || elements.addressInput.value
  } else {
    elements.addressInput.setAttribute('disabled', 'disabled')
  }

  elements.goBack.hidden = !currentApp.showNavigation
  elements.goForward.hidden = !currentApp.showNavigation
  elements.reload.hidden = !currentApp.showNavigation
  elements.goBack.disabled = !currentApp.showNavigation || !currentApp.canGoBack
  elements.goForward.disabled = !currentApp.showNavigation || !currentApp.canGoForward
  elements.reload.disabled = !currentApp.showNavigation

  elements.pageTitle.textContent = currentApp.title || 'Loiterly'

  if (currentApp.isLoading) {
    elements.pageStatus.textContent = 'Loading...'
  } else if (currentApp.showAddressBar) {
    elements.pageStatus.textContent = 'Ready'
  } else {
    elements.pageStatus.textContent = 'Embedded app'
  }

  elements.globalShortcut.replaceChildren(
    ...formatShortcut(state.globalShortcut).map((part) => {
      const key = document.createElement('span')
      key.className = 'shortcut-key'
      key.textContent = part
      return key
    })
  )
}

function publishBounds() {
  const rect = elements.contentHost.getBoundingClientRect()
  shell.setContentBounds({
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  })
}

function setState(nextState) {
  if (nextState.activeApp) {
    state.activeApp = nextState.activeApp
  }

  if (nextState.apps) {
    for (const [appId, appState] of Object.entries(nextState.apps)) {
      state.apps[appId] = { ...(state.apps[appId] || createAppState(appId, appId)), ...appState }
    }
  }

  if (nextState.globalShortcut) {
    state.globalShortcut = nextState.globalShortcut
  }

  render()
}

elements.tiles.forEach((tile) => {
  tile.addEventListener('click', () => {
    const appId = tile.dataset.app
    state.activeApp = appId
    render()
    shell.setActiveApp(appId)
  })
})

elements.addressForm.addEventListener('submit', (event) => {
  event.preventDefault()
  shell.navigate(elements.addressInput.value)
})

elements.goBack.addEventListener('click', () => shell.goBack())
elements.goForward.addEventListener('click', () => shell.goForward())
elements.reload.addEventListener('click', () => shell.reload())
elements.hideWindow.addEventListener('click', () => shell.toggleWindow())

shell.onState((nextState) => {
  setState(nextState)
})

window.addEventListener('resize', publishBounds)
window.addEventListener('load', async () => {
  const initialState = await shell.getState()
  setState(initialState)
  publishBounds()

  const resizeObserver = new ResizeObserver(() => {
    publishBounds()
  })
  resizeObserver.observe(elements.contentHost)
})
