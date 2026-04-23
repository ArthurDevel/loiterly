const shell = window.loiterlyShell

function createAppState(id, title, options = {}) {
  return {
    id,
    title,
    url: '',
    iconURL: '',
    unreadCount: 0,
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
    gmail: createAppState('gmail', 'Gmail'),
    github: createAppState('github', 'GitHub'),
    'github-issues': createAppState('github-issues', 'Issues'),
    linkedin: createAppState('linkedin', 'LinkedIn'),
    instagram: createAppState('instagram', 'Instagram'),
    openpaperdigest: createAppState('openpaperdigest', 'Open Paper Digest'),
    twitter: createAppState('twitter', 'Twitter'),
    prompts: createAppState('prompts', 'Prompts'),
    links: createAppState('links', 'Links'),
    conductor: createAppState('conductor', 'Agents'),
  },
  githubIssues: {
    owner: 'ArthurDevel',
    repos: [],
    isLoading: false,
    error: '',
    selectedRepo: 'openpoke',
  },
  globalShortcut: 'CommandOrControl+Shift+L',
  updateOffer: null,
}

const elements = {
  tiles: Array.from(document.querySelectorAll('.tile')),
  tileIcons: Array.from(document.querySelectorAll('.tile-icon')),
  tileBadges: Array.from(document.querySelectorAll('.tile-badge')),
  contentHost: document.getElementById('content-host'),
  contentStage: document.getElementById('content-stage'),
  addressForm: document.getElementById('address-form'),
  addressInput: document.getElementById('address-input'),
  navControls: document.querySelector('.nav-controls'),
  pageTitle: document.getElementById('page-title'),
  pageStatus: document.getElementById('page-status'),
  issuesShortcuts: document.getElementById('issues-shortcuts'),
  issuesShortcutsStatus: document.getElementById('issues-shortcuts-status'),
  issuesShortcutsList: document.getElementById('issues-shortcuts-list'),
  goBack: document.getElementById('go-back'),
  goForward: document.getElementById('go-forward'),
  reload: document.getElementById('reload'),
  hideWindow: document.getElementById('hide-window'),
  globalShortcut: document.getElementById('global-shortcut'),
  updateCard: document.getElementById('update-card'),
  updateTitle: document.getElementById('update-title'),
  updateDetail: document.getElementById('update-detail'),
  updateAction: document.getElementById('update-action'),
  main: document.querySelector('.main'),
  toolbar: document.querySelector('.toolbar'),
}

function setTileIconSource(tileIcon, iconURL) {
  const image = tileIcon.querySelector('.tile-icon__image')
  const fallback = tileIcon.querySelector('.tile-icon__fallback')

  if (!image || !fallback) {
    return
  }

  if (!iconURL || image.dataset.failedSrc === iconURL) {
    image.hidden = true
    image.removeAttribute('src')
    fallback.hidden = false
    tileIcon.classList.remove('has-image')
    return
  }

  if (image.dataset.src !== iconURL) {
    image.src = iconURL
    image.dataset.src = iconURL
  }

  image.hidden = false
  fallback.hidden = true
  tileIcon.classList.add('has-image')
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

function createRepoShortcut(repo, owner, isActive) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = `issues-shortcuts__chip${isActive ? ' is-active' : ''}`
  button.textContent = repo.name
  button.title = `${owner}/${repo.name}`
  button.addEventListener('click', () => {
    state.activeApp = 'github-issues'
    render()
    shell.setActiveApp('github-issues')
    shell.openAppURL('github-issues', repo.issuesURL)
  })
  return button
}

function renderGitHubIssuesShortcuts() {
  const isVisible = state.activeApp === 'github-issues'
  elements.issuesShortcuts.hidden = !isVisible

  if (!isVisible) {
    elements.issuesShortcutsStatus.textContent = ''
    elements.issuesShortcutsList.replaceChildren()
    return
  }

  const { owner, repos, isLoading, error, selectedRepo } = state.githubIssues

  if (isLoading && repos.length < 1) {
    elements.issuesShortcutsStatus.textContent = 'Loading repositories...'
    const loading = document.createElement('span')
    loading.className = 'issues-shortcuts__message'
    loading.textContent = 'Fetching repository shortcuts from GitHub.'
    elements.issuesShortcutsList.replaceChildren(loading)
    return
  }

  if (error && repos.length < 1) {
    elements.issuesShortcutsStatus.textContent = 'Repositories unavailable'
    const errorMessage = document.createElement('span')
    errorMessage.className = 'issues-shortcuts__message is-error'
    errorMessage.textContent = error
    elements.issuesShortcutsList.replaceChildren(errorMessage)
    return
  }

  elements.issuesShortcutsStatus.textContent = `${repos.length} repositories`
  elements.issuesShortcutsList.replaceChildren(
    ...repos.map((repo) => createRepoShortcut(repo, owner, repo.name === selectedRepo))
  )
}

function render() {
  const currentApp = state.apps[state.activeApp] || createAppState(state.activeApp, state.activeApp)
  const showBrowserControls = currentApp.showAddressBar || currentApp.showNavigation
  const showGitHubIssuesShortcuts = state.activeApp === 'github-issues'

  elements.tiles.forEach((tile) => {
    tile.classList.toggle('is-active', tile.dataset.app === state.activeApp)
  })

  elements.tileIcons.forEach((tileIcon) => {
    const appId = tileIcon.dataset.iconFor
    setTileIconSource(tileIcon, state.apps[appId]?.iconURL || '')
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
  elements.main.classList.toggle('has-issues-shortcuts', showGitHubIssuesShortcuts)
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

  if (state.updateOffer?.downloadURL || state.updateOffer?.releaseURL) {
    elements.updateCard.hidden = false
    elements.updateTitle.textContent = state.updateOffer.summary || 'A new version is available'
    elements.updateDetail.textContent = state.updateOffer.detail || ''
    elements.updateAction.textContent = state.updateOffer.buttonLabel || 'Install Latest'
  } else {
    elements.updateCard.hidden = true
    elements.updateTitle.textContent = ''
    elements.updateDetail.textContent = ''
    elements.updateAction.textContent = ''
  }

  renderGitHubIssuesShortcuts()
}

function publishBounds() {
  const rect = elements.contentStage.getBoundingClientRect()
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

  if (nextState.githubIssues) {
    state.githubIssues = {
      ...state.githubIssues,
      ...nextState.githubIssues,
    }
  }

  if (Object.prototype.hasOwnProperty.call(nextState, 'updateOffer')) {
    state.updateOffer = nextState.updateOffer || null
  }

  render()
}

elements.tileIcons.forEach((tileIcon) => {
  const image = tileIcon.querySelector('.tile-icon__image')
  const fallback = tileIcon.querySelector('.tile-icon__fallback')

  if (!image || !fallback) {
    return
  }

  image.addEventListener('error', () => {
    const failedSrc = image.dataset.src || image.currentSrc || ''
    if (failedSrc) {
      image.dataset.failedSrc = failedSrc
    }

    image.hidden = true
    image.removeAttribute('src')
    fallback.hidden = false
    tileIcon.classList.remove('has-image')
  })

  image.addEventListener('load', () => {
    delete image.dataset.failedSrc
    image.hidden = false
    fallback.hidden = true
    tileIcon.classList.add('has-image')
  })
})

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
elements.updateAction.addEventListener('click', () => {
  const targetURL = state.updateOffer?.downloadURL || state.updateOffer?.releaseURL
  if (!targetURL) {
    return
  }

  shell.openExternal(targetURL)
})

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
