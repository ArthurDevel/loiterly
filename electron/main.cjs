const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')
const { autoUpdater } = require('electron-updater')
const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  Menu,
  Tray,
  WebContentsView,
  globalShortcut,
  nativeImage,
  screen,
  ipcMain,
  shell,
} = require('electron')

const WINDOW_WIDTH = 1140
const WINDOW_HEIGHT = 760
const WINDOW_MARGIN = 16
const POPUP_WIDTH = 720
const POPUP_HEIGHT = 700
const POPUP_MARGIN = 48
const GLOBAL_TOGGLE_SHORTCUT = 'CommandOrControl+Shift+L'
const COMPANION_SIZE = 24
const COMPANION_OFFSET = { x: 10, y: -14 }
const ACTIVE_SPACE_HOP_DELAY_MS = 140
const CONDUCTOR_REFRESH_MS = 5000
const RELEASE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
const CONTENT_VIEW_RADIUS = 23
const SHARED_REMOTE_PARTITION = 'persist:loiterly-browser'
const GITHUB_RELEASES_URL = 'https://github.com/ArthurDevel/loiterly/releases'
const GITHUB_LATEST_RELEASE_API_URL = 'https://api.github.com/repos/ArthurDevel/loiterly/releases/latest'
const GITHUB_ISSUES_OWNER = 'ArthurDevel'
const GITHUB_ISSUES_DEFAULT_REPO = 'openpoke'
const GITHUB_ISSUES_REPOS_URL = `https://github.com/${GITHUB_ISSUES_OWNER}?tab=repositories`
const CONDUCTOR_DB_PATH = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'com.conductor.app',
  'conductor.db'
)
const PROMPT_SOURCE_CONFIGS = [
  {
    id: 'codex-prompts',
    label: 'Codex Prompts',
    rootPath: path.join(os.homedir(), '.codex', 'prompts'),
  },
  {
    id: 'claude-commands',
    label: 'Claude Commands',
    rootPath: path.join(os.homedir(), '.claude', 'commands'),
  },
  {
    id: 'claude-agents',
    label: 'Claude Agents',
    rootPath: path.join(os.homedir(), '.claude', 'agents'),
  },
]
const PROMPT_FILE_EXTENSIONS = new Set(['.md', '.markdown', '.mdx', '.txt', '.prompt'])
const MAX_PROMPT_FILE_SIZE_BYTES = 256 * 1024
const APP_CONFIGS = [
  {
    id: 'browser',
    label: 'Browser',
    type: 'remote',
    partition: SHARED_REMOTE_PARTITION,
    initialURL: 'https://www.google.com',
    showAddressBar: true,
    showNavigation: true,
  },
  {
    id: 'notion',
    label: 'Notion',
    type: 'remote',
    partition: SHARED_REMOTE_PARTITION,
    initialURL: 'https://www.notion.so',
    showAddressBar: false,
    showNavigation: false,
  },
  {
    id: 'github',
    label: 'GitHub',
    type: 'remote',
    partition: SHARED_REMOTE_PARTITION,
    initialURL: 'https://github.com',
    showAddressBar: false,
    showNavigation: false,
  },
  {
    id: 'github-issues',
    label: 'Issues',
    type: 'remote',
    partition: SHARED_REMOTE_PARTITION,
    initialURL: `https://github.com/${GITHUB_ISSUES_OWNER}/${GITHUB_ISSUES_DEFAULT_REPO}/issues`,
    showAddressBar: false,
    showNavigation: false,
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    type: 'remote',
    partition: SHARED_REMOTE_PARTITION,
    initialURL: 'https://www.linkedin.com/messaging/',
    showAddressBar: false,
    showNavigation: false,
  },
  {
    id: 'instagram',
    label: 'Instagram',
    type: 'remote',
    partition: SHARED_REMOTE_PARTITION,
    initialURL: 'https://www.instagram.com',
    showAddressBar: false,
    showNavigation: false,
  },
  {
    id: 'twitter',
    label: 'Twitter',
    type: 'remote',
    partition: SHARED_REMOTE_PARTITION,
    initialURL: 'https://x.com',
    showAddressBar: false,
    showNavigation: false,
  },
  {
    id: 'links',
    label: 'Links',
    type: 'local',
    showAddressBar: false,
    showNavigation: false,
  },
  {
    id: 'prompts',
    label: 'Prompts',
    type: 'local',
    showAddressBar: false,
    showNavigation: false,
  },
  {
    id: 'conductor',
    label: 'Conductor',
    type: 'local',
    showAddressBar: false,
    showNavigation: false,
  },
]

let tray = null
let mainWindow = null
let companionWindow = null
let backdropWindow = null
let isQuitting = false
let activeApp = 'browser'
let contentBounds = { x: 120, y: 84, width: 980, height: 640 }
let isCompanionEnabled = true
let isCompanionSuppressedForTyping = false
let companionInterval = null
let conductorRefreshInterval = null
let releaseCheckInterval = null
let companionPosition = null
let lastCursorPoint = null
let isCheckingForUpdates = false
let isFetchingLatestRelease = false
let updateStatusLabel = 'Manual updates only'
let updateErrorMessage = ''
let downloadedUpdateVersion = null
let latestReleaseInfo = {
  version: '',
  downloadURL: '',
  releaseURL: `${GITHUB_RELEASES_URL}/latest`,
  available: false,
}
let redirectingHostedAppIds = new Set()
const linkedInStyleKeys = new WeakMap()
const hostedAppUnreadCounts = new Map()

const views = new Map()
const visibleViews = new Set()
const apps = new Map(APP_CONFIGS.map((appConfig) => [appConfig.id, appConfig]))
const hostedAppHomeURLs = new Map()
const localAppSignatures = new Map()
const localAppScrollPositions = new Map()
const popupWindows = new Set()
const configuredPermissionPartitions = new Set()
let githubIssuesReposState = {
  owner: GITHUB_ISSUES_OWNER,
  repos: [],
  isLoading: false,
  error: '',
}
let githubIssuesReposPromise = null

function handleCompanionKeyboardActivity() {
  if (isCompanionSuppressedForTyping) {
    return
  }

  isCompanionSuppressedForTyping = true
  syncCompanionVisibility()
}

function handleCompanionPointerActivity() {
  if (!isCompanionSuppressedForTyping) {
    return
  }

  isCompanionSuppressedForTyping = false
  syncCompanionVisibility()
}

function attachCompanionInputTracking(contents) {
  if (!contents || contents.isDestroyed()) {
    return
  }

  contents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown') {
      handleCompanionKeyboardActivity()
    }
  })

  contents.on('before-mouse-event', () => {
    handleCompanionPointerActivity()
  })
}

function createShellWindow() {
  const window = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: 920,
    minHeight: 620,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  attachCompanionInputTracking(window.webContents)
  window.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  window.setWindowButtonVisibility(false)
  window.setAlwaysOnTop(true, 'floating')

  window.on('close', (event) => {
    if (isQuitting) {
      return
    }

    event.preventDefault()
    hideWindow()
  })

  window.on('blur', () => {
    if (isQuitting || !window.isVisible()) {
      return
    }

    setTimeout(() => {
      if (isQuitting || !window.isVisible() || window.isFocused()) {
        return
      }

      if (shouldIgnoreBlurHide()) {
        return
      }

      hideWindow()
    }, 120)
  })

  window.on('focus', () => {
    if (isQuitting || !window.isVisible()) {
      return
    }

    if (hasOpenPopupWindow()) {
      closePopupWindows()
    }
  })

  window.on('closed', () => {
    mainWindow = null
  })

  window.on('move', layoutPopupWindows)
  window.on('resize', layoutPopupWindows)

  return window
}

function currentCursorDisplay() {
  const cursor = screen.getCursorScreenPoint()
  return screen.getDisplayNearestPoint(cursor)
}

function currentCursorWorkArea() {
  return currentCursorDisplay().workArea
}

function clampWindowOriginToArea(point, area) {
  return {
    x: Math.min(
      Math.max(point.x, area.x + WINDOW_MARGIN),
      area.x + area.width - WINDOW_WIDTH - WINDOW_MARGIN
    ),
    y: Math.min(
      Math.max(point.y, area.y + WINDOW_MARGIN),
      area.y + area.height - WINDOW_HEIGHT - WINDOW_MARGIN
    ),
  }
}

function createBackdropWindow() {
  const window = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000001',
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'backdrop-preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  window.setAlwaysOnTop(true, 'floating')
  window.setWindowButtonVisibility(false)
  window.loadFile(path.join(__dirname, 'backdrop', 'index.html'))

  return window
}

function createCompanionWindow() {
  const window = new BrowserWindow({
    width: COMPANION_SIZE,
    height: COMPANION_SIZE,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  window.setAlwaysOnTop(true, 'screen-saver')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.setIgnoreMouseEvents(true, { forward: true })
  window.setWindowButtonVisibility(false)
  window.loadFile(path.join(__dirname, 'companion', 'index.html'))
  window.webContents.on('did-finish-load', () => {
    updateCompanionUnreadBadge()
  })

  return window
}

function createTray() {
  const image = nativeImage.createFromDataURL(createTrayIconDataUrl())
  image.setTemplateImage(true)
  const trayImage = image.resize({ width: 18, height: 18 })
  trayImage.setTemplateImage(true)

  tray = new Tray(trayImage)
  tray.setToolTip('Loiterly')
  if (process.platform === 'darwin') {
    tray.setTitle('L')
  }
  refreshTrayMenu()
}

function updaterSupported() {
  return process.platform === 'darwin'
}

function updaterEnabled() {
  return updaterSupported() && (app.isPackaged || process.env.LOITERLY_ENABLE_DEV_UPDATES === '1')
}

function setUpdateStatus(label, options = {}) {
  updateStatusLabel = label

  if (Object.prototype.hasOwnProperty.call(options, 'errorMessage')) {
    updateErrorMessage = options.errorMessage || ''
  }

  if (Object.prototype.hasOwnProperty.call(options, 'downloadedVersion')) {
    downloadedUpdateVersion = options.downloadedVersion || null
  }

  refreshTrayMenu()
}

function sanitizeVersion(value) {
  return String(value || '')
    .trim()
    .replace(/^[^\d]*/, '')
    .replace(/[^\d.].*$/, '')
}

function compareVersions(left, right) {
  const leftParts = sanitizeVersion(left).split('.').filter(Boolean).map((part) => Number.parseInt(part, 10) || 0)
  const rightParts = sanitizeVersion(right).split('.').filter(Boolean).map((part) => Number.parseInt(part, 10) || 0)
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] || 0
    const rightValue = rightParts[index] || 0

    if (leftValue > rightValue) {
      return 1
    }

    if (leftValue < rightValue) {
      return -1
    }
  }

  return 0
}

function releaseVersionFromPayload(release) {
  return sanitizeVersion(release?.tag_name || release?.name || '')
}

function currentUpdateOffer() {
  if (!latestReleaseInfo.available) {
    return null
  }

  return {
    version: latestReleaseInfo.version,
    downloadURL: latestReleaseInfo.downloadURL,
    releaseURL: latestReleaseInfo.releaseURL,
    buttonLabel: 'Install Latest',
    summary: `Version ${latestReleaseInfo.version} is available`,
    detail: 'Download the newest build and replace the app in Applications.',
  }
}

function buildUpdateMenuItems() {
  const items = [
    {
      label: updateStatusLabel,
      enabled: false,
    },
  ]

  if (updaterEnabled()) {
    items.push({
      label: 'Check for Updates',
      enabled: !isCheckingForUpdates,
      click: () => {
        checkForAppUpdates(true)
      },
    })
  } else {
    items.push({
      label: isFetchingLatestRelease ? 'Looking up latest release…' : 'Download Latest Release',
      enabled: !isFetchingLatestRelease,
      click: () => {
        void downloadLatestRelease()
      },
    })
    items.push({
      label: 'Open Releases Page',
      click: () => {
        shell.openExternal(GITHUB_RELEASES_URL)
      },
    })
  }

  if (downloadedUpdateVersion) {
    items.push({
      label: `Install Update ${downloadedUpdateVersion} and Restart`,
      click: () => {
        installDownloadedUpdate()
      },
    })
  }

  if (updateErrorMessage) {
    items.push({
      label: 'Open Update Error',
      click: () => {
        dialog.showErrorBox('Loiterly update failed', updateErrorMessage)
      },
    })
  }

  return items
}

function refreshTrayMenu() {
  if (!tray) {
    return
  }

  const menu = Menu.buildFromTemplate([
    {
      label: mainWindow && mainWindow.isVisible() ? 'Hide Loiterly' : 'Show Loiterly',
      click: () => toggleWindowVisibility(),
    },
    {
      label: 'Cursor Companion',
      type: 'checkbox',
      checked: isCompanionEnabled,
      click: () => {
        toggleCompanion()
      },
    },
    { type: 'separator' },
    {
      label: `Version ${app.getVersion()}`,
      enabled: false,
    },
    ...buildUpdateMenuItems(),
    { type: 'separator' },
    {
      label: `Shortcut: ${GLOBAL_TOGGLE_SHORTCUT}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])

  tray.setContextMenu(menu)
}

function configureAutoUpdater() {
  if (!updaterSupported()) {
    setUpdateStatus('Manual updates only', {
      errorMessage: '',
      downloadedVersion: null,
    })
    return
  }

  if (!updaterEnabled()) {
    setUpdateStatus('Manual updates only', {
      errorMessage: '',
      downloadedVersion: null,
    })
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    isCheckingForUpdates = true
    setUpdateStatus('Checking for updates…', {
      errorMessage: '',
      downloadedVersion: null,
    })
  })

  autoUpdater.on('update-available', (info) => {
    isCheckingForUpdates = false
    const version = info?.version ? `v${info.version}` : 'new release'
    setUpdateStatus(`Downloading ${version}…`, {
      errorMessage: '',
      downloadedVersion: null,
    })
  })

  autoUpdater.on('update-not-available', () => {
    isCheckingForUpdates = false
    setUpdateStatus(`Up to date (v${app.getVersion()})`, {
      errorMessage: '',
      downloadedVersion: null,
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    const percent = Number.isFinite(progress?.percent) ? Math.round(progress.percent) : null
    const suffix = percent === null ? '' : ` ${percent}%`
    setUpdateStatus(`Downloading update…${suffix}`, {
      errorMessage: '',
      downloadedVersion: null,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    isCheckingForUpdates = false
    const version = info?.version ? `v${info.version}` : 'ready'
    setUpdateStatus(`Update ready (${version})`, {
      errorMessage: '',
      downloadedVersion: version,
    })
  })

  autoUpdater.on('error', (error) => {
    isCheckingForUpdates = false
    const message = error?.message || 'Unknown updater error'
    setUpdateStatus('Update check failed', {
      errorMessage: message,
      downloadedVersion: null,
    })
  })

  setUpdateStatus(`Version ${app.getVersion()}`, {
    errorMessage: '',
    downloadedVersion: null,
  })

  setTimeout(() => {
    checkForAppUpdates(false)
  }, 4000)
}

function checkForAppUpdates(manual = false) {
  if (!updaterEnabled()) {
    if (manual) {
      dialog.showMessageBox({
        type: 'info',
        message: 'This build uses manual updates.',
        detail: 'Use the Download Latest Release item in the tray menu to install a new DMG.',
      }).catch(() => {})
    }
    return
  }

  if (isCheckingForUpdates) {
    return
  }

  autoUpdater.checkForUpdates().catch((error) => {
    isCheckingForUpdates = false
    const message = error?.message || 'Unknown updater error'
    setUpdateStatus('Update check failed', {
      errorMessage: message,
      downloadedVersion: null,
    })
    if (manual) {
      dialog.showErrorBox('Loiterly update failed', message)
    }
  })
}

function installDownloadedUpdate() {
  if (!downloadedUpdateVersion) {
    return
  }

  isQuitting = true
  autoUpdater.quitAndInstall()
}

function preferredReleaseAssetSuffix() {
  if (process.platform === 'darwin') {
    if (process.arch === 'arm64') {
      return '-arm64.dmg'
    }

    if (process.arch === 'x64') {
      return '-x64.dmg'
    }

    return '.dmg'
  }

  return ''
}

function chooseReleaseAsset(assets) {
  if (!Array.isArray(assets) || assets.length === 0) {
    return null
  }

  const preferredSuffix = preferredReleaseAssetSuffix()
  if (preferredSuffix) {
    const exactMatch = assets.find((asset) => typeof asset?.name === 'string' && asset.name.endsWith(preferredSuffix))
    if (exactMatch) {
      return exactMatch
    }
  }

  const dmgMatch = assets.find((asset) => typeof asset?.name === 'string' && asset.name.endsWith('.dmg'))
  if (dmgMatch) {
    return dmgMatch
  }

  const zipMatch = assets.find((asset) => typeof asset?.name === 'string' && asset.name.endsWith('.zip'))
  if (zipMatch) {
    return zipMatch
  }

  return null
}

async function fetchLatestReleaseInfo() {
  if (typeof fetch !== 'function') {
    throw new Error('This Electron runtime does not support fetch in the main process.')
  }

  const response = await fetch(GITHUB_LATEST_RELEASE_API_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
    },
  })

  if (!response.ok) {
    throw new Error(`GitHub release lookup failed with HTTP ${response.status}.`)
  }

  const release = await response.json()
  const asset = chooseReleaseAsset(release?.assets)
  const version = releaseVersionFromPayload(release)
  const releaseURL = release?.html_url || `${GITHUB_RELEASES_URL}/latest`

  latestReleaseInfo = {
    version,
    downloadURL: asset?.browser_download_url || releaseURL,
    releaseURL,
    available: Boolean(version) && compareVersions(version, app.getVersion()) > 0,
  }

  emitState()
  return latestReleaseInfo
}

async function refreshLatestReleaseInfo() {
  if (isFetchingLatestRelease) {
    return latestReleaseInfo
  }

  isFetchingLatestRelease = true
  refreshTrayMenu()

  try {
    const release = await fetchLatestReleaseInfo()

    if (!updaterEnabled()) {
      setUpdateStatus(
        release.available ? `Update available (${release.version})` : 'Manual updates only',
        {
          errorMessage: '',
          downloadedVersion: null,
        }
      )
    }

    return release
  } catch {
    return latestReleaseInfo
  } finally {
    isFetchingLatestRelease = false
    refreshTrayMenu()
  }
}

async function downloadLatestRelease() {
  if (isFetchingLatestRelease) {
    return
  }

  isFetchingLatestRelease = true
  refreshTrayMenu()

  try {
    const release = await fetchLatestReleaseInfo()
    const targetURL = release.downloadURL || release.releaseURL || `${GITHUB_RELEASES_URL}/latest`

    if (!targetURL) {
      throw new Error('No downloadable release asset was found.')
    }

    await shell.openExternal(targetURL)
  } catch (error) {
    const message = error?.message || 'Failed to find the latest release.'
    dialog.showMessageBox({
      type: 'error',
      message: 'Unable to download the latest release',
      detail: `${message}\n\nOpening the releases page instead.`,
    }).catch(() => {})
    shell.openExternal(`${GITHUB_RELEASES_URL}/latest`)
  } finally {
    isFetchingLatestRelease = false
    refreshTrayMenu()
  }
}

function createViews() {
  for (const appConfig of APP_CONFIGS) {
    if (appConfig.type === 'local') {
      views.set(appConfig.id, createLocalAppView(appConfig))
      continue
    }

    views.set(appConfig.id, createHostedAppView(appConfig))
  }
}

function createHostedAppView(appConfig) {
  const view = new WebContentsView({
    webPreferences: {
      partition: appConfig.partition,
      preload: path.join(__dirname, 'hosted-app-preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      autoplayPolicy: 'user-gesture-required',
    },
  })

  const contents = view.webContents
  const browserSession = contents.session

  attachCompanionInputTracking(contents)
  configureSessionPermissions(browserSession, appConfig)

  contents.setWindowOpenHandler(({ url }) => {
    if (shouldOpenExternally(url)) {
      shell.openExternal(url)
      return { action: 'deny' }
    }

    return popupWindowResponse(appConfig)
  })

  contents.on('will-navigate', (event, url) => {
    if (shouldOpenExternally(url)) {
      event.preventDefault()
      shell.openExternal(url)
      return
    }

    if (!shouldKeepHostedNavigation(appConfig, url)) {
      event.preventDefault()
      openURLInPopup(appConfig, url)
      return
    }

    emitState()
  })
  contents.on('did-start-loading', emitState)
  contents.on('did-stop-loading', emitState)
  contents.on('did-redirect-navigation', () => {
    enforceHostedAppLocation(appConfig, contents)
  })
  contents.on('did-navigate', () => {
    enforceHostedAppLocation(appConfig, contents)
    emitState()
  })
  contents.on('did-navigate-in-page', () => {
    enforceHostedAppLocation(appConfig, contents)
    emitState()
  })
  contents.on('page-title-updated', emitState)
  contents.on('page-favicon-updated', emitState)
  contents.on('did-finish-load', () => {
    enforceHostedAppLocation(appConfig, contents)
    syncHostedAppStyles(appConfig, contents)
    syncHostedAppObservers(appConfig, contents)
  })
  contents.on('did-navigate-in-page', () => {
    syncHostedAppStyles(appConfig, contents)
    syncHostedAppObservers(appConfig, contents)
  })

  contents.loadURL(appConfig.initialURL)
  return view
}

function githubIssuesURL(repoName) {
  return `https://github.com/${GITHUB_ISSUES_OWNER}/${encodeURIComponent(repoName)}/issues`
}

function isGitHubAuthRoute(pathname) {
  const normalizedPath = `${pathname || ''}`.toLowerCase()

  return (
    normalizedPath === '/login' ||
    normalizedPath.startsWith('/login/') ||
    normalizedPath === '/session' ||
    normalizedPath.startsWith('/sessions/')
  )
}

function parseGitHubIssuesRoute(target) {
  try {
    const url = new URL(target)
    const hostname = url.hostname.toLowerCase()

    if (hostname !== 'github.com' && hostname !== 'www.github.com') {
      return null
    }

    if (isGitHubAuthRoute(url.pathname)) {
      return {
        url,
        repo: '',
        isAllowed: true,
        isIssuesRoute: false,
      }
    }

    const segments = url.pathname.split('/').filter(Boolean)
    const owner = `${segments[0] || ''}`.toLowerCase()
    const repo = `${segments[1] || ''}`.trim()
    const section = `${segments[2] || ''}`.toLowerCase()

    if (owner !== GITHUB_ISSUES_OWNER.toLowerCase() || !repo) {
      return {
        url,
        repo: '',
        isAllowed: false,
        isIssuesRoute: false,
      }
    }

    return {
      url,
      repo,
      isAllowed: section === 'issues',
      isIssuesRoute: section === 'issues',
    }
  } catch {
    return null
  }
}

function syncHostedAppHomeURL(appId, target) {
  if (appId !== 'github-issues') {
    return
  }

  const route = parseGitHubIssuesRoute(target)
  if (!route?.isIssuesRoute || !route.repo) {
    return
  }

  hostedAppHomeURLs.set(appId, githubIssuesURL(route.repo))
}

function shouldKeepHostedNavigation(appConfig, target) {
  if (!target) {
    return true
  }

  if (appConfig.id === 'linkedin') {
    return isLinkedInMessagingRoute(target)
  }

  return true
}

function isLinkedInMessagingRoute(target) {
  try {
    const url = new URL(target)
    const hostname = url.hostname.toLowerCase()
    const pathname = url.pathname.toLowerCase()

    if (hostname !== 'linkedin.com' && hostname !== 'www.linkedin.com') {
      return false
    }

    return (
      pathname === '/messaging' ||
      pathname === '/messaging/' ||
      pathname.startsWith('/messaging/') ||
      pathname === '/login' ||
      pathname.startsWith('/uas/') ||
      pathname.startsWith('/checkpoint/') ||
      pathname.startsWith('/authwall')
    )
  } catch {
    return false
  }
}

function syncHostedAppStyles(appConfig, contents) {
  if (!appConfig || !contents || contents.isDestroyed()) {
    return
  }

  if (appConfig.id !== 'linkedin') {
    return
  }

  const currentURL = contents.getURL()
  if (!currentURL || !isLinkedInMessagingRoute(currentURL)) {
    return
  }

  const previousKey = linkedInStyleKeys.get(contents)
  if (previousKey) {
    contents.removeInsertedCSS(previousKey).catch(() => {})
  }

  contents.insertCSS(linkedInMessagingCSS()).then((key) => {
    linkedInStyleKeys.set(contents, key)
  }).catch(() => {})
}

function linkedInMessagingCSS() {
  return `
    .global-nav,
    header.global-nav,
    .msg-overlay-list-bubble,
    .msg-overlay-conversation-bubble,
    .msg-overlay-bubble-header,
    .msg-overlay-bubble-header__controls,
    .msg-overlay-bubble-header__badge,
    .msg-overlay-list-bubble__container {
      display: none !important;
    }

    body,
    .application-outlet,
    .authentication-outlet,
    .scaffold-layout,
    .msg-layout,
    .msg-conversations-container__conversations-list,
    .msg-conversations-container__conversation-card {
      --global-nav-header-offset: 0px !important;
      --global-nav-header-height: 0px !important;
    }

    .scaffold-layout,
    .msg-layout,
    .application-outlet,
    .authentication-outlet {
      padding-top: 0 !important;
      margin-top: 0 !important;
    }

    .msg-conversations-container__conversations-list,
    .msg-conversations-container__conversation-card,
    .msg-thread,
    .msg-thread__container,
    .msg-thread__top-card {
      top: 0 !important;
      margin-top: 0 !important;
    }
  `
}

function syncHostedAppObservers(appConfig, contents) {
  if (!appConfig || !contents || contents.isDestroyed()) {
    return
  }

  if (appConfig.id !== 'linkedin') {
    return
  }

  const currentURL = contents.getURL()
  if (!currentURL || !isLinkedInMessagingInboxRoute(currentURL)) {
    clearHostedAppUnreadCount(appConfig.id)
    teardownLinkedInUnreadObserver(contents)
    return
  }

  contents.executeJavaScript(linkedInUnreadObserverScript(appConfig.id)).catch(() => {})
}

function isLinkedInMessagingInboxRoute(target) {
  try {
    const url = new URL(target)
    const pathname = url.pathname.toLowerCase()
    return pathname === '/messaging' || pathname === '/messaging/' || pathname.startsWith('/messaging/')
  } catch {
    return false
  }
}

function teardownLinkedInUnreadObserver(contents) {
  if (!contents || contents.isDestroyed()) {
    return
  }

  contents.executeJavaScript(`
    (() => {
      if (window.__loiterlyLinkedInUnreadObserver) {
        window.__loiterlyLinkedInUnreadObserver.disconnect()
        delete window.__loiterlyLinkedInUnreadObserver
      }

      if (window.__loiterlyLinkedInUnreadTimer) {
        window.clearTimeout(window.__loiterlyLinkedInUnreadTimer)
        delete window.__loiterlyLinkedInUnreadTimer
      }

      delete window.__loiterlyLinkedInLastUnreadCount
    })()
  `).catch(() => {})
}

function linkedInUnreadObserverScript(appId) {
  return `
    (() => {
      const eventName = 'loiterly:hosted-app-unread-count'
      const appId = ${JSON.stringify(appId)}

      const parseNumericText = (value) => {
        const normalized = \`\${value || ''}\`.trim()
        if (!normalized) {
          return 0
        }

        if (/^\\d+\\+$/.test(normalized)) {
          return Number.parseInt(normalized, 10)
        }

        const match = normalized.match(/\\d+/)
        return match ? Number.parseInt(match[0], 10) : 0
      }

      const readUnreadCount = () => {
        const navBadge = document.querySelector('a[href*="/messaging"] [class*="notification-badge"]')
        if (!navBadge) {
          return 0
        }

        const text = navBadge.textContent || navBadge.getAttribute('aria-label') || ''
        return parseNumericText(text)
      }

      const publishUnreadCount = () => {
        const unreadCount = Math.max(0, Math.min(999, readUnreadCount()))
        if (window.__loiterlyLinkedInLastUnreadCount === unreadCount) {
          return
        }

        window.__loiterlyLinkedInLastUnreadCount = unreadCount
        window.dispatchEvent(new CustomEvent(eventName, {
          detail: {
            appId,
            unreadCount,
          },
        }))
      }

      const scheduleUnreadCheck = () => {
        if (window.__loiterlyLinkedInUnreadTimer) {
          window.clearTimeout(window.__loiterlyLinkedInUnreadTimer)
        }

        window.__loiterlyLinkedInUnreadTimer = window.setTimeout(() => {
          publishUnreadCount()
        }, 300)
      }

      if (window.__loiterlyLinkedInUnreadObserver) {
        window.__loiterlyLinkedInUnreadObserver.disconnect()
      }

      const observer = new MutationObserver(() => {
        scheduleUnreadCheck()
      })

      observer.observe(document.documentElement || document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      })

      window.__loiterlyLinkedInUnreadObserver = observer
      window.addEventListener('beforeunload', () => {
        observer.disconnect()
      }, { once: true })

      publishUnreadCount()
    })()
  `
}

function normalizedUnreadCount(value) {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.min(999, Math.trunc(value)))
}

function setHostedAppUnreadCount(appId, unreadCount) {
  const nextCount = normalizedUnreadCount(unreadCount)
  const currentCount = hostedAppUnreadCounts.get(appId) || 0

  if (currentCount === nextCount) {
    return
  }

  hostedAppUnreadCounts.set(appId, nextCount)
  emitState()
}

function clearHostedAppUnreadCount(appId) {
  setHostedAppUnreadCount(appId, 0)
}

function selectedGitHubIssuesRepo() {
  const currentURL = views.get('github-issues')?.webContents?.getURL?.()
  const currentRoute = parseGitHubIssuesRoute(currentURL)
  if (currentRoute?.repo) {
    return currentRoute.repo
  }

  const homeRoute = parseGitHubIssuesRoute(hostedAppHomeURLs.get('github-issues'))
  if (homeRoute?.repo) {
    return homeRoute.repo
  }

  if (githubIssuesReposState.repos.some((repo) => repo.name === GITHUB_ISSUES_DEFAULT_REPO)) {
    return GITHUB_ISSUES_DEFAULT_REPO
  }

  return githubIssuesReposState.repos[0]?.name || GITHUB_ISSUES_DEFAULT_REPO
}

function githubIssuesShellState() {
  return {
    owner: githubIssuesReposState.owner,
    repos: githubIssuesReposState.repos.map((repo) => ({
      name: repo.name,
      url: repo.url,
      issuesURL: githubIssuesURL(repo.name),
    })),
    isLoading: githubIssuesReposState.isLoading,
    error: githubIssuesReposState.error,
    selectedRepo: selectedGitHubIssuesRepo(),
  }
}

async function refreshGitHubIssuesRepos() {
  if (githubIssuesReposPromise) {
    return githubIssuesReposPromise
  }

  githubIssuesReposState = {
    ...githubIssuesReposState,
    isLoading: true,
    error: '',
  }
  emitState()

  const issuesView = views.get('github-issues')
  const contents = issuesView?.webContents
  if (!contents || contents.isDestroyed()) {
    githubIssuesReposState = {
      ...githubIssuesReposState,
      isLoading: false,
      error: 'GitHub Issues view is unavailable.',
    }
    emitState()
    return
  }

  const scrapeScript = `
    (() => {
      const owner = ${JSON.stringify(GITHUB_ISSUES_OWNER)}
      const targetURL = ${JSON.stringify(GITHUB_ISSUES_REPOS_URL)}
      const repoPattern = new RegExp('^/' + owner + '/([^/?#]+)$', 'i')

      return fetch(targetURL, {
        credentials: 'include',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
        },
      }).then(async (response) => {
        const html = await response.text()
        const document = new DOMParser().parseFromString(html, 'text/html')
        const loginRequired =
          response.url.includes('/login') ||
          Boolean(document.querySelector('form[action="/session"], #login'))

        const candidates = [
          ...document.querySelectorAll('a[itemprop="name codeRepository"]'),
          ...document.querySelectorAll('#user-repositories-list a[href^="/' + owner + '/"]'),
          ...document.querySelectorAll('a[data-hovercard-type="repository"][href^="/' + owner + '/"]'),
        ]

        const seen = new Set()
        const repos = []

        for (const anchor of candidates) {
          const href = (anchor.getAttribute('href') || '').trim()
          const match = href.match(repoPattern)
          if (!match) {
            continue
          }

          const name = decodeURIComponent((match[1] || '').trim())
          if (!name || seen.has(name)) {
            continue
          }

          seen.add(name)
          repos.push({
            name,
            url: new URL(href, 'https://github.com').toString(),
          })
        }

        return {
          ok: response.ok,
          status: response.status,
          loginRequired,
          repos,
        }
      })
    })()
  `

  githubIssuesReposPromise = contents.executeJavaScript(scrapeScript, true)
    .then((result) => {
      if (!result?.ok) {
        throw new Error(`GitHub repositories lookup failed with HTTP ${result?.status || 'unknown'}.`)
      }

      if (result.loginRequired) {
        throw new Error('GitHub login required in the Issues app to load repository shortcuts.')
      }

      const repos = Array.isArray(result.repos)
        ? result.repos
            .map((repo) => ({
              name: `${repo?.name || ''}`.trim(),
              url: `${repo?.url || ''}`.trim(),
            }))
            .filter((repo) => repo.name && repo.url)
        : []

      if (repos.length < 1) {
        throw new Error(`No repository links found on ${GITHUB_ISSUES_REPOS_URL}.`)
      }

      githubIssuesReposState = {
        ...githubIssuesReposState,
        repos,
        isLoading: false,
        error: '',
      }

      const preferredRepo = repos.find((repo) => repo.name === GITHUB_ISSUES_DEFAULT_REPO) || repos[0]
      const currentRoute = parseGitHubIssuesRoute(views.get('github-issues')?.webContents?.getURL?.())
      const currentRepoIsAvailable = currentRoute?.repo
        ? repos.some((repo) => repo.name === currentRoute.repo)
        : false

      if (preferredRepo && (!hostedAppHomeURLs.has('github-issues') || !currentRepoIsAvailable)) {
        const nextURL = githubIssuesURL(preferredRepo.name)
        hostedAppHomeURLs.set('github-issues', nextURL)

        if (!currentRepoIsAvailable && currentRoute?.isAllowed) {
          views.get('github-issues')?.webContents.loadURL(nextURL).catch(() => {})
        }
      }
    })
    .catch((error) => {
      githubIssuesReposState = {
        ...githubIssuesReposState,
        isLoading: false,
        error: error instanceof Error ? error.message : String(error),
      }
    })
    .finally(() => {
      githubIssuesReposPromise = null
      emitState()
    })

  return githubIssuesReposPromise
}

function popupWindowOptions(appConfig) {
  return {
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
    minWidth: 420,
    minHeight: 560,
    show: false,
    hasShadow: true,
    backgroundColor: '#0b1220',
    autoHideMenuBar: true,
    fullscreenable: false,
    maximizable: false,
    minimizable: true,
    resizable: true,
    movable: true,
    skipTaskbar: true,
    titleBarStyle: 'hiddenInset',
    parent: mainWindow || undefined,
    modal: false,
    webPreferences: {
      partition: appConfig.partition,
      preload: path.join(__dirname, 'hosted-app-preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      autoplayPolicy: 'user-gesture-required',
    },
  }
}

function createManagedPopupWindow(appConfig, options = popupWindowOptions(appConfig)) {
  const popupWindow = new BrowserWindow(options)
  popupWindows.add(popupWindow)
  attachCompanionInputTracking(popupWindow.webContents)
  popupWindow.setAlwaysOnTop(true, 'floating')
  popupWindow.setWindowButtonVisibility(true)
  centerPopupWindow(popupWindow)

  popupWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (shouldOpenExternally(url)) {
      shell.openExternal(url)
      return { action: 'deny' }
    }

    return popupWindowResponse(appConfig)
  })

  popupWindow.on('closed', () => {
    popupWindows.delete(popupWindow)
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      mainWindow.focus()
    }
  })

  popupWindow.once('ready-to-show', () => {
    if (!popupWindow.isDestroyed()) {
      centerPopupWindow(popupWindow)
      showOnActiveSpace(popupWindow, () => {
        popupWindow.show()
        popupWindow.focus()
      })
    }
  })

  return popupWindow
}

function openURLInPopup(appConfig, target) {
  const popupWindow = createManagedPopupWindow(appConfig)
  popupWindow.loadURL(target)
}

function enforceHostedAppLocation(appConfig, contents) {
  if (!appConfig || !contents || contents.isDestroyed()) {
    return
  }

  if (redirectingHostedAppIds.has(appConfig.id)) {
    return
  }

  const currentURL = contents.getURL()
  if (!currentURL || shouldOpenExternally(currentURL) || shouldKeepHostedNavigation(appConfig, currentURL)) {
    syncHostedAppHomeURL(appConfig.id, currentURL)
    return
  }

  redirectingHostedAppIds.add(appConfig.id)
  openURLInPopup(appConfig, currentURL)
  const fallbackURL = hostedAppHomeURLs.get(appConfig.id) || appConfig.initialURL
  contents.loadURL(fallbackURL).finally(() => {
    redirectingHostedAppIds.delete(appConfig.id)
    emitState()
  })
}

function configureSessionPermissions(browserSession, appConfig) {
  if (configuredPermissionPartitions.has(appConfig.partition)) {
    return
  }

  configuredPermissionPartitions.add(appConfig.partition)

  browserSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const origin = permissionOrigin(requestingOrigin, details, webContents)
    if (!isTrustedPermissionOrigin(origin)) {
      return false
    }

    return shouldAutoGrantPermission(permission)
  })

  browserSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const origin = permissionOrigin(details?.requestingUrl, details, webContents)
    const ownerWindow = permissionOwnerWindow(webContents)

    if (!isTrustedPermissionOrigin(origin)) {
      console.log(`[permissions] denied ${permission} for untrusted origin ${origin}`)
      callback(false)
      return
    }

    if (shouldAutoGrantPermission(permission)) {
      console.log(`[permissions] auto-allowed ${permission} for ${origin}`)
      callback(true)
      return
    }

    const permissionName = humanPermissionName(permission)
    dialog.showMessageBox(ownerWindow, {
      type: 'question',
      buttons: ['Allow', 'Deny'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      message: `${appConfig.label} wants ${permissionName}`,
      detail: `${origin}\n\nAllow this site to use ${permissionName.toLowerCase()}?`,
    }).then(({ response }) => {
      const allowed = response === 0
      console.log(`[permissions] ${allowed ? 'allowed' : 'denied'} ${permission} for ${origin}`)
      callback(allowed)
    }).catch(() => {
      callback(false)
    })
  })
}

function permissionOrigin(requestingUrl, details, webContents) {
  const candidate =
    requestingUrl ||
    details?.requestingUrl ||
    details?.embeddingOrigin ||
    details?.securityOrigin ||
    webContents?.getURL?.() ||
    ''

  try {
    return new URL(candidate).origin
  } catch {
    return candidate || 'unknown origin'
  }
}

function isTrustedPermissionOrigin(origin) {
  return typeof origin === 'string' && /^https:\/\//i.test(origin)
}

function shouldAutoGrantPermission(permission) {
  return (
    permission === 'fullscreen' ||
    permission === 'clipboard-sanitized-write' ||
    permission.includes('storage') ||
    permission === 'window-management'
  )
}

function permissionOwnerWindow(webContents) {
  if (webContents) {
    const ownerWindow = BrowserWindow.fromWebContents(webContents)
    if (ownerWindow && !ownerWindow.isDestroyed()) {
      return ownerWindow
    }
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow
  }

  return null
}

function humanPermissionName(permission) {
  const labels = {
    'clipboard-read': 'clipboard read access',
    'clipboard-sanitized-write': 'clipboard write access',
    'display-capture': 'screen capture',
    fullscreen: 'fullscreen control',
    geolocation: 'location access',
    'idle-detection': 'idle detection',
    media: 'camera or microphone access',
    mediaKeySystem: 'protected media access',
    midi: 'MIDI access',
    midiSysex: 'MIDI system exclusive access',
    notifications: 'notifications',
    pointerLock: 'pointer lock',
    keyboardLock: 'keyboard lock',
    openExternal: 'the ability to open external apps',
    'speaker-selection': 'speaker selection',
    'storage-access': 'storage access',
    'top-level-storage-access': 'top-level storage access',
    'persistent-storage': 'persistent storage',
    'window-management': 'screen enumeration',
    fileSystem: 'file system access',
    hid: 'hardware security device access',
    usb: 'USB device access',
    serial: 'serial device access',
  }

  return labels[permission] || permission
}

function popupWindowResponse(appConfig) {
  return {
    action: 'allow',
    overrideBrowserWindowOptions: popupWindowOptions(appConfig),
    outlivesOpener: false,
    createWindow: (options) => {
      const popupWindow = createManagedPopupWindow(appConfig, options)
      return popupWindow.webContents
    },
  }
}

function centerPopupWindow(popupWindow) {
  if (!popupWindow || popupWindow.isDestroyed()) {
    return
  }

  const cursorDisplay = currentCursorDisplay()
  const cursorArea = cursorDisplay.workArea
  const anchorWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
  const parentBounds = anchorWindow && isWindowOnDisplay(anchorWindow, cursorDisplay)
    ? anchorWindow.getBounds()
    : cursorArea
  const popupBounds = popupWindow.getBounds()
  const width = Math.min(popupBounds.width, Math.max(420, parentBounds.width - POPUP_MARGIN * 2))
  const height = Math.min(popupBounds.height, Math.max(560, parentBounds.height - POPUP_MARGIN * 2))

  popupWindow.setBounds({
    x: Math.round(parentBounds.x + (parentBounds.width - width) / 2),
    y: Math.round(parentBounds.y + (parentBounds.height - height) / 2),
    width,
    height,
  })
}

function isWindowOnDisplay(window, display) {
  if (!window || window.isDestroyed()) {
    return false
  }

  const bounds = window.getBounds()
  const centerPoint = {
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2),
  }

  return screen.getDisplayNearestPoint(centerPoint).id === display.id
}

function layoutPopupWindows() {
  for (const popupWindow of [...popupWindows]) {
    if (!popupWindow || popupWindow.isDestroyed()) {
      popupWindows.delete(popupWindow)
      continue
    }

    centerPopupWindow(popupWindow)
  }
}

function placeWindowGroupNearCursor() {
  if (!mainWindow || !backdropWindow) {
    return
  }

  const cursor = screen.getCursorScreenPoint()
  const cursorDisplay = screen.getDisplayNearestPoint(cursor)
  const workArea = cursorDisplay.workArea
  const origin = clampWindowOriginToArea({
    x: cursor.x + 24,
    y: cursor.y - WINDOW_HEIGHT + 32,
  }, workArea)

  backdropWindow.setBounds({
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
  })

  mainWindow.setBounds({
    x: origin.x,
    y: origin.y,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
  })
}

function createLocalAppView(appConfig) {
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'local-app-preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  attachCompanionInputTracking(view.webContents)
  refreshLocalAppView(appConfig.id, view)
  view.webContents.on('page-title-updated', emitState)
  view.webContents.on('did-finish-load', emitState)
  view.webContents.executeJavaScript(`document.title = ${JSON.stringify(appConfig.label)}`)
  return view
}

function refreshLocalAppView(appId, existingView = null) {
  const view = existingView || views.get(appId)
  if (!view || view.webContents.isDestroyed()) {
    return
  }

  let html = ''
  let signature = `${appId}:static`
  if (appId === 'links') {
    html = linksMarkup()
  } else if (appId === 'prompts') {
    const snapshot = loadPromptLibrarySnapshot()
    html = promptsMarkup(snapshot)
    signature = snapshot.signature
  } else if (appId === 'conductor') {
    const snapshot = loadConductorSnapshot()
    html = conductorMarkup(snapshot)
    signature = snapshot.signature
  }

  if (!html) {
    return
  }

  if (localAppSignatures.get(appId) === signature) {
    return
  }

  const currentURL = view.webContents.getURL()
  const shouldCaptureScroll =
    Boolean(currentURL) &&
    currentURL !== 'about:blank' &&
    !view.webContents.isLoading()

  if (!shouldCaptureScroll) {
    localAppSignatures.set(appId, signature)
    view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    return
  }

  captureLocalAppScrollPosition(appId, view).then((scrollPosition) => {
    if (!view || view.webContents.isDestroyed()) {
      return
    }

    localAppSignatures.set(appId, signature)
    view.webContents.once('did-finish-load', () => {
      restoreLocalAppScrollPosition(appId, view, scrollPosition)
    })
    view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  })
}

function captureLocalAppScrollPosition(appId, view) {
  const fallbackPosition = localAppScrollPositions.get(appId) || { x: 0, y: 0 }
  if (!view || view.webContents.isDestroyed()) {
    return Promise.resolve(fallbackPosition)
  }

  return view.webContents.executeJavaScript('({ x: window.scrollX || 0, y: window.scrollY || 0 })', true)
    .then((position) => {
      const nextPosition = sanitizeScrollPosition(position, fallbackPosition)
      localAppScrollPositions.set(appId, nextPosition)
      return nextPosition
    })
    .catch(() => fallbackPosition)
}

function restoreLocalAppScrollPosition(appId, view, scrollPosition) {
  if (!view || view.webContents.isDestroyed()) {
    return
  }

  const nextPosition = sanitizeScrollPosition(
    scrollPosition,
    localAppScrollPositions.get(appId) || { x: 0, y: 0 }
  )
  localAppScrollPositions.set(appId, nextPosition)
  view.webContents.executeJavaScript(
    `window.scrollTo(${nextPosition.x}, ${nextPosition.y});`,
    true
  ).catch(() => {})
}

function sanitizeScrollPosition(position, fallbackPosition) {
  const fallback = fallbackPosition || { x: 0, y: 0 }
  const x = Number.isFinite(position?.x) ? Math.max(0, Math.round(position.x)) : fallback.x
  const y = Number.isFinite(position?.y) ? Math.max(0, Math.round(position.y)) : fallback.y

  return { x, y }
}
function ensureVisibleView(appId) {
  if (!mainWindow) {
    return
  }

  const targetView = views.get(appId)
  if (!targetView) {
    return
  }

  for (const visibleView of [...visibleViews]) {
    if (visibleView === targetView) {
      continue
    }

    mainWindow.contentView.removeChildView(visibleView)
    visibleViews.delete(visibleView)
  }

  if (!visibleViews.has(targetView)) {
    mainWindow.contentView.addChildView(targetView)
    visibleViews.add(targetView)
  }

  layoutActiveView()
}

function layoutActiveView() {
  const targetView = views.get(activeApp)
  if (!targetView) {
    return
  }

  targetView.setBounds(contentBounds)
  try {
    targetView.setBorderRadius(CONTENT_VIEW_RADIUS)
    targetView.setBackgroundColor('#00000000')
  } catch {
  }
}

function setActiveApp(appId) {
  if (!apps.has(appId) || !views.has(appId)) {
    return
  }

  const appConfig = apps.get(appId)
  if (appConfig && appConfig.type === 'local') {
    refreshLocalAppView(appId)
  }

  if (appId === 'github-issues' && !githubIssuesReposState.isLoading && githubIssuesReposState.repos.length < 1) {
    void refreshGitHubIssuesRepos()
  }

  activeApp = appId
  ensureVisibleView(activeApp)
  emitState()
}

function updateContentBounds(bounds) {
  contentBounds = bounds
  layoutActiveView()
}

function navigateBrowser(input) {
  const browserView = views.get('browser')
  if (!browserView) {
    return
  }

  const trimmed = `${input || ''}`.trim()
  if (!trimmed) {
    return
  }

  let target = trimmed
  if (!/^https?:\/\//i.test(trimmed)) {
    if (trimmed.includes(' ')) {
      target = `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
    } else {
      target = `https://${trimmed}`
    }
  }

  browserView.webContents.loadURL(target)
}

function openAppURL(appId, target) {
  if (shouldOpenExternally(target)) {
    shell.openExternal(target)
    return
  }

  const view = views.get(appId)
  if (!view) {
    return
  }

  syncHostedAppHomeURL(appId, target)
  view.webContents.loadURL(target)
}

function shouldOpenExternally(target) {
  if (!target) {
    return false
  }

  try {
    const { protocol } = new URL(target)
    return protocol !== 'http:' && protocol !== 'https:'
  } catch {
    return false
  }
}

function defaultAppState(appId) {
  const appConfig = apps.get(appId)

  return {
    id: appId,
    title: appConfig ? appConfig.label : 'Loiterly',
    url: appConfig && appConfig.showAddressBar ? appConfig.initialURL || '' : '',
    unreadCount: hostedAppUnreadCounts.get(appId) || 0,
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
    showAddressBar: appConfig ? appConfig.showAddressBar : false,
    showNavigation: appConfig ? appConfig.showNavigation : false,
    activeCount: 0,
    unreadCount: 0,
    hasAlert: false,
  }
}

function appState(appId, conductorSnapshot = null) {
  if (appId === 'conductor') {
    const snapshot = conductorSnapshot || loadConductorSnapshot()

    return {
      ...defaultAppState(appId),
      title: 'Conductor',
      activeCount: snapshot.activeAgents.length,
      unreadCount: snapshot.unreadAgents.length,
      hasAlert: snapshot.unreadAgents.length > 0,
    }
  }

  const view = views.get(appId)
  if (!view) {
    return defaultAppState(appId)
  }

  const appConfig = apps.get(appId)
  const contents = view.webContents
  if (!contents || contents.isDestroyed()) {
    return defaultAppState(appId)
  }

  const isRemoteApp = appConfig && appConfig.type === 'remote'
  const navigationHistory = contents.navigationHistory

  return {
    id: appId,
    url: appConfig && appConfig.showAddressBar ? (contents.getURL() || appConfig.initialURL || '') : '',
    title: contents.getTitle() || (appConfig ? appConfig.label : 'Loiterly'),
    unreadCount: hostedAppUnreadCounts.get(appId) || 0,
    canGoBack: isRemoteApp && navigationHistory ? navigationHistory.canGoBack() : false,
    canGoForward: isRemoteApp && navigationHistory ? navigationHistory.canGoForward() : false,
    isLoading: contents.isLoading(),
    showAddressBar: appConfig ? appConfig.showAddressBar : false,
    showNavigation: appConfig ? appConfig.showNavigation : false,
  }
}

function allAppStates(conductorSnapshot = null) {
  const state = {}
  const snapshot = conductorSnapshot || loadConductorSnapshot()

  for (const appConfig of APP_CONFIGS) {
    state[appConfig.id] = appState(appConfig.id, snapshot)
  }

  return state
}

function emitState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  const conductorSnapshot = loadConductorSnapshot()

  mainWindow.webContents.send('shell:state', {
    activeApp,
    apps: allAppStates(conductorSnapshot),
    githubIssues: githubIssuesShellState(),
    globalShortcut: GLOBAL_TOGGLE_SHORTCUT,
    updateOffer: currentUpdateOffer(),
  })

  updateCompanionUnreadBadge(conductorSnapshot)
  refreshTrayMenu()
}

function updateCompanionUnreadBadge(conductorSnapshot = null) {
  if (!companionWindow || companionWindow.isDestroyed()) {
    return
  }

  const snapshot = conductorSnapshot || loadConductorSnapshot()
  const hasUnread = snapshot.unreadAgents.length > 0

  companionWindow.webContents.executeJavaScript(
    `
      (() => {
        const badge = document.querySelector('.companion-badge')
        if (!badge) return
        badge.hidden = ${hasUnread ? 'false' : 'true'}
      })()
    `,
    true
  ).catch(() => {})
}

function startConductorRefresh() {
  if (conductorRefreshInterval) {
    return
  }

  conductorRefreshInterval = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return
    }

    emitState()

    if (activeApp === 'conductor' && mainWindow.isVisible()) {
      refreshLocalAppView('conductor')
    }
  }, CONDUCTOR_REFRESH_MS)
}

function startReleaseChecks() {
  if (releaseCheckInterval) {
    return
  }

  void refreshLatestReleaseInfo()
  releaseCheckInterval = setInterval(() => {
    void refreshLatestReleaseInfo()
  }, RELEASE_CHECK_INTERVAL_MS)
}

function loadPromptLibrarySnapshot() {
  const sources = PROMPT_SOURCE_CONFIGS.map((sourceConfig) => {
    try {
      const prompts = collectPromptFiles(sourceConfig.rootPath)

      return {
        id: sourceConfig.id,
        label: sourceConfig.label,
        rootPath: sourceConfig.rootPath,
        promptCount: prompts.length,
        prompts,
      }
    } catch (error) {
      return {
        id: sourceConfig.id,
        label: sourceConfig.label,
        rootPath: sourceConfig.rootPath,
        promptCount: 0,
        prompts: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })

  const prompts = sources.flatMap((source) => source.prompts)
  const signature = JSON.stringify(
    sources.map((source) => ({
      id: source.id,
      rootPath: source.rootPath,
      error: source.error || '',
      prompts: source.prompts.map((prompt) => ({
        path: prompt.absolutePath,
        size: prompt.size,
        modifiedAt: prompt.modifiedAt,
      })),
    }))
  )

  return {
    sources,
    promptCount: prompts.length,
    refreshedAt: new Date().toISOString(),
    signature,
  }
}

function collectPromptFiles(rootPath) {
  if (!fs.existsSync(rootPath)) {
    return []
  }

  const prompts = []
  const stack = [rootPath]

  while (stack.length > 0) {
    const currentPath = stack.pop()
    const entries = fs.readdirSync(currentPath, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue
      }

      const absolutePath = path.join(currentPath, entry.name)

      if (entry.isDirectory()) {
        stack.push(absolutePath)
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      const extension = path.extname(entry.name).toLowerCase()
      if (!PROMPT_FILE_EXTENSIONS.has(extension)) {
        continue
      }

      const stats = fs.statSync(absolutePath)
      if (stats.size > MAX_PROMPT_FILE_SIZE_BYTES) {
        continue
      }

      const content = fs.readFileSync(absolutePath, 'utf8')
      if (!content.trim()) {
        continue
      }

      const relativePath = path.relative(rootPath, absolutePath) || entry.name
      const title = path.basename(entry.name, extension) || entry.name

      prompts.push({
        id: `${relativePath}:${stats.mtimeMs}:${stats.size}`,
        title,
        fileName: entry.name,
        extension,
        relativePath,
        absolutePath,
        modifiedAt: stats.mtime.toISOString(),
        size: stats.size,
        lineCount: content.split(/\r?\n/).length,
        preview: promptPreview(content),
        content,
      })
    }
  }

  prompts.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  return prompts
}

function promptPreview(content) {
  const normalized = `${content || ''}`.replace(/\s+/g, ' ').trim()
  const firstSentence = normalized.match(/^.*?[.!?](?:\s|$)/)
  const preview = firstSentence?.[0]?.trim() || normalized

  if (preview.length <= 140) {
    return preview
  }

  return `${preview.slice(0, 137)}...`
}

function promptsMarkup({ sources, promptCount, refreshedAt }) {
  const refreshedLabel = escapeHtml(
    new Date(refreshedAt).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  )

  let promptIndex = 0
  const promptData = sources.flatMap((source) => {
    return source.prompts.map((prompt) => ({
      ...prompt,
      promptIndex: promptIndex++,
      sourceId: source.id,
      sourceLabel: source.label,
      sourceGroup: source.id.startsWith('codex-') ? 'codex' : 'claude',
      rootPath: source.rootPath,
    }))
  })
  const tableRows = promptData.map((prompt) => {
    const recordIndex = prompt.promptIndex

    return `
      <tr class="prompt-row" data-source-group="${escapeHtml(prompt.sourceGroup)}" data-prompt-index="${recordIndex}" data-open-prompt="${recordIndex}">
        <td class="prompt-name-cell">
          <div class="prompt-name">${escapeHtml(prompt.title)}</div>
          <div class="prompt-meta">${escapeHtml(prompt.sourceLabel)} · ${escapeHtml(prompt.relativePath)}</div>
        </td>
        <td class="prompt-preview-cell">${escapeHtml(prompt.preview)}</td>
        <td class="prompt-action-cell">
          <button type="button" class="table-action" data-copy-prompt="${recordIndex}">Copy</button>
        </td>
      </tr>
    `
  }).join('')

  const errors = sources
    .filter((source) => source.error)
    .map((source) => `${source.label}: ${source.error}`)
  const emptyMessage = promptCount < 1
    ? 'No prompt files were found in ~/.codex/prompts, ~/.claude/commands, or ~/.claude/agents.'
    : ''
  const statusMessage = errors.length > 0
    ? errors.map((message) => `<div>${escapeHtml(message)}</div>`).join('')
    : (emptyMessage ? `<div>${escapeHtml(emptyMessage)}</div>` : '')

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Prompts</title>
        <style>
          :root {
            color-scheme: light;
            --bg: #edf2f7;
            --panel: rgba(255, 255, 255, 0.76);
            --panel-strong: rgba(255, 255, 255, 0.92);
            --border: rgba(147, 163, 184, 0.24);
            --text: #172030;
            --muted: #617086;
            --accent: #2e68db;
            --accent-soft: rgba(74, 132, 245, 0.12);
            --accent-strong: #1f53b8;
            --shadow: rgba(103, 120, 146, 0.12);
            --success: #0f9d6c;
            --danger: #d84c4c;
          }
          * {
            box-sizing: border-box;
          }
          body {
            margin: 0;
            min-height: 100vh;
            padding: 28px;
            background:
              radial-gradient(circle at top left, rgba(255,255,255,0.86), rgba(255,255,255,0) 34%),
              linear-gradient(180deg, #fbfcfe 0%, var(--bg) 100%);
            color: var(--text);
            font-family: "SF Pro Display", "Helvetica Neue", sans-serif;
          }
          header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 18px;
          }
          h1 {
            margin: 0;
            letter-spacing: -0.04em;
            font-size: 28px;
          }
          .subtitle {
            margin: 4px 0 0;
            color: var(--muted);
            line-height: 1.4;
          }
          .subtitle code {
            font-family: "SF Mono", "Menlo", monospace;
            font-size: 12px;
          }
          .meta {
            text-align: right;
            color: var(--muted);
            font-size: 12px;
          }
          .toolbar {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 16px;
            padding: 14px 16px;
            border-radius: 18px;
            background: linear-gradient(180deg, var(--panel-strong), var(--panel));
            border: 1px solid var(--border);
            box-shadow:
              0 14px 30px var(--shadow),
              inset 0 1px 0 rgba(255,255,255,0.84);
          }
          .toolbar-left,
          .toolbar-right {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 10px;
          }
          .filter-group {
            display: inline-flex;
            padding: 4px;
            border-radius: 999px;
            background: rgba(74, 132, 245, 0.08);
          }
          .filter-button {
            border: none;
            background: transparent;
            color: var(--muted);
            border-radius: 999px;
            padding: 8px 14px;
            font-weight: 700;
            cursor: pointer;
          }
          .filter-button.is-active {
            background: white;
            color: var(--accent-strong);
            box-shadow: 0 8px 18px rgba(103, 120, 146, 0.12);
          }
          .toolbar-right input {
            width: min(320px, 56vw);
            border: 1px solid rgba(123, 141, 167, 0.24);
            border-radius: 12px;
            padding: 10px 12px;
            background: rgba(255,255,255,0.86);
            color: var(--text);
          }
          .toolbar-right button,
          .table-action,
          .modal-copy,
          .modal-close {
            border: none;
            border-radius: 12px;
            padding: 10px 14px;
            background: var(--accent);
            color: white;
            font-weight: 700;
            cursor: pointer;
          }
          .modal-close {
            background: rgba(74, 132, 245, 0.12);
            color: var(--accent-strong);
          }
          .status-row {
            min-height: 20px;
            margin-bottom: 12px;
            color: var(--muted);
            font-size: 13px;
          }
          .status-row.is-success {
            color: var(--success);
          }
          .status-row.is-error {
            color: var(--danger);
          }
          .table-shell {
            overflow: hidden;
            border-radius: 20px;
            background: linear-gradient(180deg, var(--panel-strong), var(--panel));
            border: 1px solid var(--border);
            box-shadow:
              0 16px 36px rgba(103, 120, 146, 0.08),
              inset 0 1px 0 rgba(255,255,255,0.84);
          }
          table {
            width: 100%;
            border-collapse: collapse;
          }
          thead th {
            padding: 14px 18px;
            text-align: left;
            font-size: 12px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: var(--muted);
            border-bottom: 1px solid rgba(147, 163, 184, 0.16);
          }
          tbody td {
            padding: 16px 18px;
            vertical-align: top;
            border-bottom: 1px solid rgba(147, 163, 184, 0.12);
          }
          .prompt-row {
            cursor: pointer;
            transition: background-color 120ms ease, box-shadow 120ms ease;
          }
          .prompt-row:hover td {
            background: rgba(74, 132, 245, 0.06);
          }
          .prompt-row:hover .prompt-name {
            color: var(--accent-strong);
          }
          tbody tr:last-child td {
            border-bottom: none;
          }
          .prompt-name {
            font-size: 15px;
            font-weight: 700;
            line-height: 1.35;
          }
          .prompt-meta {
            margin-top: 4px;
            color: var(--muted);
            font-size: 12px;
            line-height: 1.4;
            word-break: break-word;
          }
          .prompt-preview-cell {
            color: var(--muted-strong);
            line-height: 1.5;
          }
          .prompt-action-cell {
            width: 112px;
            text-align: right;
          }
          .empty-state {
            padding: 28px;
            text-align: center;
            color: var(--muted);
          }
          .empty-state strong {
            display: block;
            margin-bottom: 6px;
            color: var(--text);
          }
          .modal[hidden] {
            display: none !important;
          }
          .modal {
            position: fixed;
            inset: 0;
            display: grid;
            place-items: center;
            padding: 24px;
            background: rgba(15, 23, 42, 0.24);
            backdrop-filter: blur(8px);
          }
          .modal-card {
            width: min(920px, 100%);
            max-height: min(80vh, 900px);
            overflow: hidden;
            display: grid;
            grid-template-rows: auto 1fr auto;
            border-radius: 24px;
            background: linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,250,253,0.96));
            border: 1px solid rgba(147, 163, 184, 0.2);
            box-shadow: 0 24px 60px rgba(15, 23, 42, 0.18);
          }
          .modal-header,
          .modal-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 18px 20px;
          }
          .modal-header {
            border-bottom: 1px solid rgba(147, 163, 184, 0.14);
          }
          .modal-footer {
            border-top: 1px solid rgba(147, 163, 184, 0.14);
          }
          .modal-title {
            font-size: 20px;
            font-weight: 700;
            letter-spacing: -0.03em;
          }
          .modal-subtitle {
            margin-top: 4px;
            color: var(--muted);
            font-size: 12px;
            line-height: 1.4;
          }
          .modal-body {
            padding: 0 20px 20px;
          }
          .modal-body pre {
            margin: 0;
            padding: 18px;
            height: 100%;
            max-height: min(56vh, 720px);
            overflow: auto;
            white-space: pre-wrap;
            word-break: break-word;
            border-radius: 18px;
            background: rgba(20, 31, 48, 0.94);
            color: #f2f7ff;
            font-family: "SF Mono", "Menlo", monospace;
            font-size: 12px;
            line-height: 1.55;
          }
          @media (max-width: 760px) {
            body {
              padding: 18px;
            }
            header,
            .toolbar,
            .modal-header,
            .modal-footer {
              flex-direction: column;
              align-items: flex-start;
            }
            .toolbar-right input {
              width: 100%;
            }
            thead {
              display: none;
            }
            tbody,
            tr,
            td {
              display: block;
              width: 100%;
            }
            tbody td {
              padding-top: 10px;
              padding-bottom: 10px;
            }
            .prompt-action-cell {
              text-align: left;
              padding-top: 0;
              padding-bottom: 16px;
            }
          }
        </style>
      </head>
      <body>
        <header>
          <div>
            <h1>Prompts</h1>
            <p class="subtitle">
              Browse prompts from <code>~/.codex</code> and <code>~/.claude</code>.
            </p>
          </div>
          <div class="meta">
            Last refreshed<br />
            <strong>${refreshedLabel}</strong>
          </div>
        </header>

        <section class="toolbar">
          <div class="toolbar-left">
            <div class="filter-group">
              <button class="filter-button is-active" type="button" data-filter="all">All</button>
              <button class="filter-button" type="button" data-filter="claude">Claude</button>
              <button class="filter-button" type="button" data-filter="codex">Codex</button>
            </div>
            <div class="meta">
              <strong id="results-count">${promptCount}</strong> prompts
            </div>
          </div>
          <div class="toolbar-right">
            <input id="prompt-search" type="search" placeholder="Search titles, paths, or prompt text" autocomplete="off" spellcheck="false" />
            <button id="refresh-prompts" type="button">Refresh</button>
          </div>
        </section>

        <div id="copy-status" class="status-row${errors.length > 0 ? ' is-error' : ''}" aria-live="polite">${statusMessage}</div>

        <section class="table-shell">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Preview</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="prompt-table-body">
              ${tableRows}
            </tbody>
          </table>
          <div id="empty-state" class="empty-state" hidden>
            <strong>No prompts match</strong>
            <span>Try a different search or switch Claude/Codex.</span>
          </div>
        </section>

        <div id="prompt-modal" class="modal" hidden>
          <div class="modal-card">
            <div class="modal-header">
              <div>
                <div id="modal-title" class="modal-title"></div>
                <div id="modal-subtitle" class="modal-subtitle"></div>
              </div>
              <button id="modal-close-top" class="modal-close" type="button">Close</button>
            </div>
            <div class="modal-body">
              <pre id="modal-content"></pre>
            </div>
            <div class="modal-footer">
              <div id="modal-feedback" class="status-row" style="margin: 0;"></div>
              <div class="toolbar-right">
                <button id="modal-close-bottom" class="modal-close" type="button">Close</button>
                <button id="modal-copy" class="modal-copy" type="button">Copy Prompt</button>
              </div>
            </div>
          </div>
        </div>

        <script>
          const promptRecords = ${serializeForInlineScript(promptData)}
          const searchInput = document.getElementById('prompt-search')
          const refreshButton = document.getElementById('refresh-prompts')
          const resultsCount = document.getElementById('results-count')
          const statusRow = document.getElementById('copy-status')
          const rows = Array.from(document.querySelectorAll('.prompt-row'))
          const filterButtons = Array.from(document.querySelectorAll('.filter-button'))
          const emptyState = document.getElementById('empty-state')
          const promptModal = document.getElementById('prompt-modal')
          const modalTitle = document.getElementById('modal-title')
          const modalSubtitle = document.getElementById('modal-subtitle')
          const modalContent = document.getElementById('modal-content')
          const modalFeedback = document.getElementById('modal-feedback')
          const modalCopy = document.getElementById('modal-copy')
          const modalCloseTop = document.getElementById('modal-close-top')
          const modalCloseBottom = document.getElementById('modal-close-bottom')
          let activeFilter = 'all'
          let activePromptIndex = -1
          let statusTimer = null
          let copyButtonTimer = null

          const showStatus = (element, message, className = '') => {
            element.textContent = message
            element.classList.toggle('is-success', className === 'success')
            element.classList.toggle('is-error', className === 'error')
            if (statusTimer) {
              window.clearTimeout(statusTimer)
            }
            statusTimer = window.setTimeout(() => {
              if (element === statusRow && ${errors.length} > 0) {
                return
              }
              element.textContent = ''
              element.classList.remove('is-success')
              element.classList.remove('is-error')
            }, 1800)
          }

          const openPrompt = (index) => {
            const record = promptRecords[index]
            if (!record) {
              return
            }

            activePromptIndex = index
            modalTitle.textContent = record.title
            modalSubtitle.textContent = record.sourceLabel + ' · ' + record.relativePath
            modalContent.textContent = record.content
            modalFeedback.textContent = ''
            promptModal.hidden = false
          }

          const closePrompt = () => {
            promptModal.hidden = true
            activePromptIndex = -1
            modalFeedback.textContent = ''
          }

          const applyFilters = () => {
            const query = (searchInput.value || '').trim().toLowerCase()
            let visibleCount = 0

            rows.forEach((row) => {
              const index = Number.parseInt(row.dataset.promptIndex || '-1', 10)
              const record = promptRecords[index]
              if (!record) {
                row.hidden = true
                return
              }

              const matchesSource = activeFilter === 'all' || record.sourceGroup === activeFilter
              const haystack = [
                record.title,
                record.relativePath,
                record.sourceLabel,
                record.content,
              ].join('\\n').toLowerCase()
              const matchesQuery = !query || haystack.includes(query)
              const isVisible = matchesSource && matchesQuery
              row.hidden = !isVisible

              if (isVisible) {
                visibleCount += 1
              }
            })

            resultsCount.textContent = String(visibleCount)
            emptyState.hidden = visibleCount > 0
          }

          document.addEventListener('click', async (event) => {
            const filterTrigger = event.target.closest('[data-filter]')
            if (filterTrigger) {
              activeFilter = filterTrigger.dataset.filter || 'all'
              filterButtons.forEach((button) => {
                button.classList.toggle('is-active', button.dataset.filter === activeFilter)
              })
              applyFilters()
              return
            }

            const copyTrigger = event.target.closest('[data-copy-prompt]')
            if (copyTrigger) {
              const index = Number.parseInt(copyTrigger.dataset.copyPrompt || '-1', 10)
              const record = promptRecords[index]
              if (record) {
                await window.loiterlyLocalApp.copyText(record.content)
                showStatus(statusRow, 'Prompt copied', 'success')
                if (copyButtonTimer) {
                  window.clearTimeout(copyButtonTimer)
                }
                copyTrigger.textContent = 'Copied'
                copyButtonTimer = window.setTimeout(() => {
                  copyTrigger.textContent = 'Copy'
                }, 1200)
              }
              return
            }

            const openTrigger = event.target.closest('tr[data-open-prompt]')
            if (openTrigger) {
              const index = Number.parseInt(openTrigger.dataset.openPrompt || '-1', 10)
              openPrompt(index)
              return
            }

            if (event.target === promptModal) {
              closePrompt()
            }
          })

          modalCopy.addEventListener('click', async () => {
            const record = promptRecords[activePromptIndex]
            if (!record) {
              return
            }

            await window.loiterlyLocalApp.copyText(record.content)
            showStatus(modalFeedback, 'Prompt copied', 'success')
          })

          modalCloseTop.addEventListener('click', closePrompt)
          modalCloseBottom.addEventListener('click', closePrompt)

          refreshButton.addEventListener('click', () => {
            window.loiterlyLocalApp.refresh('prompts')
          })

          searchInput.addEventListener('input', applyFilters)
          window.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !promptModal.hidden) {
              closePrompt()
            }
          })

          applyFilters()
        </script>
      </body>
    </html>
  `
}

function formatBytes(value) {
  const size = Number.isFinite(value) ? Math.max(0, value) : 0
  if (size < 1024) {
    return `${size} B`
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function clampWindowOrigin(point) {
  const display = screen.getDisplayNearestPoint(point)
  return clampWindowOriginToArea(point, display.workArea)
}

function showWindow() {
  if (!mainWindow || !backdropWindow) {
    return
  }

  placeWindowGroupNearCursor()
  showOnActiveSpace(backdropWindow, () => {
    backdropWindow.showInactive()
  })

  showOnActiveSpace(mainWindow, () => {
    mainWindow.show()
    app.focus({ steal: true })
    mainWindow.focus()
  })
  ensureVisibleView(activeApp)
  emitState()
  syncCompanionVisibility()
}

function hideWindow() {
  if (!mainWindow || !backdropWindow) {
    return
  }

  closePopupWindows()
  mainWindow.hide()
  backdropWindow.hide()
  refreshTrayMenu()
  syncCompanionVisibility()
}

function toggleWindowVisibility() {
  if (!mainWindow) {
    return
  }

  if (mainWindow.isVisible()) {
    hideWindow()
  } else {
    showWindow()
  }
}

function isCompanionSuppressed() {
  return isCompanionSuppressedForTyping || Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible())
}

function syncCompanionVisibility() {
  if (!companionWindow || companionWindow.isDestroyed()) {
    return
  }

  if (!isCompanionEnabled || isCompanionSuppressed()) {
    if (companionWindow.isVisible()) {
      companionWindow.hide()
    }
    return
  }

  updateCompanionPosition()
}

function registerShortcuts() {
  globalShortcut.register(GLOBAL_TOGGLE_SHORTCUT, toggleWindowVisibility)
}

function showOnActiveSpace(window, show) {
  window.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  })
  show()
  setTimeout(() => {
    if (!window.isDestroyed()) {
      window.setVisibleOnAllWorkspaces(false, {
        visibleOnFullScreen: false,
        skipTransformProcessType: true,
      })
    }
  }, ACTIVE_SPACE_HOP_DELAY_MS)
}

function shouldIgnoreBlurHide() {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const topHotzone = display.bounds.y + 6

  return cursor.y <= topHotzone || isFocusWithinWindowGroup()
}

function isFocusWithinWindowGroup() {
  const focusedWindow = BrowserWindow.getFocusedWindow()
  if (!focusedWindow || focusedWindow.isDestroyed()) {
    return false
  }

  if (focusedWindow === mainWindow) {
    return true
  }

  for (const popupWindow of [...popupWindows]) {
    if (!popupWindow || popupWindow.isDestroyed()) {
      popupWindows.delete(popupWindow)
      continue
    }

    if (popupWindow === focusedWindow) {
      return true
    }
  }

  return false
}

function hasOpenPopupWindow() {
  for (const popupWindow of [...popupWindows]) {
    if (!popupWindow || popupWindow.isDestroyed()) {
      popupWindows.delete(popupWindow)
      continue
    }

    return true
  }

  return false
}

function closePopupWindows() {
  for (const popupWindow of [...popupWindows]) {
    if (!popupWindow || popupWindow.isDestroyed()) {
      popupWindows.delete(popupWindow)
      continue
    }

    popupWindow.close()
  }
}

function startCompanionLoop() {
  if (companionInterval) {
    return
  }

  companionInterval = setInterval(updateCompanionPosition, 1000 / 60)
}

function stopCompanionLoop() {
  if (!companionInterval) {
    return
  }

  clearInterval(companionInterval)
  companionInterval = null
}

function updateCompanionPosition() {
  if (!isCompanionEnabled || !companionWindow || companionWindow.isDestroyed()) {
    return
  }

  const cursor = screen.getCursorScreenPoint()

  if (
    isCompanionSuppressedForTyping &&
    lastCursorPoint &&
    (cursor.x !== lastCursorPoint.x || cursor.y !== lastCursorPoint.y)
  ) {
    isCompanionSuppressedForTyping = false
  }

  lastCursorPoint = { x: cursor.x, y: cursor.y }

  if (isCompanionSuppressed()) {
    if (companionWindow.isVisible()) {
      companionWindow.hide()
    }
    return
  }

  const target = {
    x: cursor.x + COMPANION_OFFSET.x,
    y: cursor.y + COMPANION_OFFSET.y,
  }

  if (!companionPosition) {
    companionPosition = { ...target }
  } else {
    companionPosition.x += (target.x - companionPosition.x) * 0.18
    companionPosition.y += (target.y - companionPosition.y) * 0.18
  }

  const roundedX = Math.round(companionPosition.x)
  const roundedY = Math.round(companionPosition.y)

  if (!companionWindow.isVisible()) {
    companionWindow.setBounds({
      x: roundedX,
      y: roundedY,
      width: COMPANION_SIZE,
      height: COMPANION_SIZE,
    })
    companionWindow.showInactive()
    return
  }

  companionWindow.setBounds({
    x: roundedX,
    y: roundedY,
    width: COMPANION_SIZE,
    height: COMPANION_SIZE,
  })
}

function showCompanion() {
  if (!companionWindow || companionWindow.isDestroyed()) {
    return
  }

  isCompanionEnabled = true
  startCompanionLoop()
  syncCompanionVisibility()
  refreshTrayMenu()
}

function hideCompanion() {
  isCompanionEnabled = false
  stopCompanionLoop()
  if (companionWindow && !companionWindow.isDestroyed()) {
    companionWindow.hide()
  }
  refreshTrayMenu()
}

function toggleCompanion() {
  if (isCompanionEnabled) {
    hideCompanion()
  } else {
    showCompanion()
  }
}

function linksMarkup() {
  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Links</title>
        <style>
          :root {
            color-scheme: light;
          }
          body {
            margin: 0;
            min-height: 100vh;
            padding: 28px;
            background:
              radial-gradient(circle at top left, rgba(255,255,255,0.85), rgba(255,255,255,0) 38%),
              linear-gradient(180deg, #fbfcfe 0%, #edf2f7 100%);
            color: #172030;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          }
          h1 {
            margin: 0 0 16px;
            font-size: 24px;
            letter-spacing: -0.03em;
          }
          .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 16px;
            max-width: 780px;
          }
          a {
            display: block;
            text-decoration: none;
            color: #172030;
            border-radius: 18px;
            padding: 18px;
            background: rgba(255,255,255,0.72);
            border: 1px solid rgba(173,184,201,0.24);
            box-shadow:
              0 14px 30px rgba(103,120,146,0.1),
              inset 0 1px 0 rgba(255,255,255,0.92);
          }
          p {
            margin: 8px 0 0;
            color: #617086;
            line-height: 1.4;
          }
        </style>
      </head>
      <body>
        <h1>Links</h1>
        <div class="grid">
          <a href="https://news.ycombinator.com">
            Hacker News
            <p>Quick test target for navigation and persistent session state.</p>
          </a>
          <a href="https://github.com">
            GitHub
            <p>Useful login/session test in the embedded Chromium view later.</p>
          </a>
          <a href="https://www.instagram.com">
            Instagram
            <p>Social app test target for login, popups, and persistent session state.</p>
          </a>
          <a href="https://x.com">
            Twitter
            <p>Timeline-heavy app target for another embedded social workflow.</p>
          </a>
          <a href="https://www.figma.com">
            Figma
            <p>Example of a heavier web app that should live inside the frame.</p>
          </a>
        </div>
      </body>
    </html>
  `
}

function loadConductorSnapshot() {
  const sql = `
    SELECT COALESCE(
      json_group_array(
        json_object(
          'sessionId', session_id,
          'workspaceId', workspace_id,
          'workspace', workspace,
          'repo', repo,
          'branch', branch,
          'title', title,
          'status', status,
          'agentType', agent_type,
          'model', model,
          'updatedAt', updated_at,
          'workspaceUnread', workspace_unread,
          'sessionUnread', session_unread,
          'unreadCount', unread_count
        )
      ),
      '[]'
    )
    FROM (
      SELECT
        s.id AS session_id,
        w.id AS workspace_id,
        COALESCE(w.directory_name, 'Unknown workspace') AS workspace,
        COALESCE(r.name, 'Unknown repo') AS repo,
        COALESCE(w.branch, '') AS branch,
        COALESCE(s.title, 'Untitled session') AS title,
        COALESCE(s.status, 'unknown') AS status,
        COALESCE(s.agent_type, 'unknown') AS agent_type,
        COALESCE(s.model, 'unknown') AS model,
        COALESCE(s.updated_at, s.created_at, '') AS updated_at,
        COALESCE(w.unread, 0) AS workspace_unread,
        COALESCE(s.unread_count, 0) AS session_unread,
        MAX(COALESCE(w.unread, 0), COALESCE(s.unread_count, 0)) AS unread_count
      FROM sessions s
      JOIN workspaces w ON w.active_session_id = s.id
      LEFT JOIN repos r ON r.id = w.repository_id
      WHERE s.status IN ('working', 'idle')
        AND w.state = 'ready'
      ORDER BY datetime(COALESCE(s.updated_at, s.created_at)) DESC
    );
  `

  try {
    const raw = execFileSync('sqlite3', [CONDUCTOR_DB_PATH, sql], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()

    const sessions = raw ? JSON.parse(raw) : []
    const normalizedSessions = Array.isArray(sessions) ? sessions : []

    return {
      activeAgents: normalizedSessions.filter((session) => session.status === 'working'),
      idleAgents: normalizedSessions.filter((session) => session.status === 'idle'),
      unreadAgents: normalizedSessions.filter((session) => Number(session.unreadCount || 0) > 0),
      dbPath: CONDUCTOR_DB_PATH,
      refreshedAt: new Date().toISOString(),
      signature: JSON.stringify(normalizedSessions),
    }
  } catch (error) {
    return {
      activeAgents: [],
      idleAgents: [],
      unreadAgents: [],
      dbPath: CONDUCTOR_DB_PATH,
      refreshedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      signature: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
    }
  }
}

function conductorMarkup({ activeAgents, idleAgents, unreadAgents, dbPath, refreshedAt, error }) {
  const refreshedLabel = escapeHtml(
    new Date(refreshedAt).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'medium',
    })
  )

  const sections = [
    sessionSectionMarkup({
      title: 'Active',
      description: 'Sessions currently running in Conductor.',
      sessions: activeAgents,
      pillClassName: 'status-pill',
      pillLabel: 'Working',
      emptyTitle: 'No active agents',
      emptyCopy: 'Conductor currently has no sessions with a <code>working</code> status.',
    }),
    sessionSectionMarkup({
      title: 'Needs Input',
      description: 'Idle sessions that are waiting on the user.',
      sessions: idleAgents,
      pillClassName: 'status-pill status-pill--alert',
      pillLabel: 'Idle',
      emptyTitle: 'No idle agents',
      emptyCopy: 'No ready Conductor workspaces are currently idle.',
    }),
  ].join('')

  const errorBanner = error
    ? `<div class="error-banner">Could not read Conductor state: ${escapeHtml(error)}</div>`
    : ''

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Conductor</title>
        <style>
          :root {
            color-scheme: light;
            --bg: #edf2f7;
            --panel: rgba(255, 255, 255, 0.76);
            --panel-strong: rgba(255, 255, 255, 0.9);
            --border: rgba(147, 163, 184, 0.24);
            --text: #172030;
            --muted: #617086;
            --accent: #2e68db;
            --accent-soft: rgba(74, 132, 245, 0.12);
            --success: #0f9d6c;
            --success-soft: rgba(15, 157, 108, 0.14);
            --alert: #d84c4c;
            --alert-soft: rgba(216, 76, 76, 0.12);
          }
          * {
            box-sizing: border-box;
          }
          body {
            margin: 0;
            min-height: 100vh;
            padding: 28px;
            background:
              radial-gradient(circle at top left, rgba(255,255,255,0.86), rgba(255,255,255,0) 34%),
              linear-gradient(180deg, #fbfcfe 0%, var(--bg) 100%);
            color: var(--text);
            font-family: "SF Pro Display", "Helvetica Neue", sans-serif;
          }
          header {
            display: flex;
            align-items: flex-end;
            justify-content: space-between;
            gap: 16px;
            margin-bottom: 20px;
          }
          h1 {
            margin: 0;
            font-size: 28px;
            letter-spacing: -0.04em;
          }
          .subtitle {
            margin: 6px 0 0;
            color: var(--muted);
            max-width: 760px;
            line-height: 1.45;
          }
          .sections {
            display: grid;
            gap: 24px;
          }
          .section-heading {
            display: flex;
            align-items: end;
            justify-content: space-between;
            gap: 16px;
            margin-bottom: 12px;
          }
          .section-heading h2 {
            margin: 0;
            font-size: 20px;
            letter-spacing: -0.03em;
          }
          .section-heading p {
            margin: 4px 0 0;
            color: var(--muted);
          }
          .meta {
            text-align: right;
            color: var(--muted);
            font-size: 12px;
          }
          .meta code {
            display: block;
            margin-top: 8px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 340px;
          }
          .summary {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 10px 14px;
            border-radius: 999px;
            background: var(--accent-soft);
            color: var(--accent);
            font-weight: 600;
            margin-bottom: 18px;
          }
          .error-banner {
            margin-bottom: 16px;
            padding: 14px 16px;
            border-radius: 16px;
            background: var(--alert-soft);
            color: var(--alert);
            border: 1px solid rgba(178, 73, 73, 0.18);
          }
          .agent-list {
            display: grid;
            gap: 16px;
          }
          .agent-card,
          .empty-state {
            padding: 18px 20px;
            border-radius: 22px;
            background: linear-gradient(180deg, var(--panel-strong), var(--panel));
            border: 1px solid var(--border);
            box-shadow:
              0 16px 36px rgba(103, 120, 146, 0.08),
              inset 0 1px 0 rgba(255,255,255,0.84);
          }
          .agent-card__top {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 16px;
            margin-bottom: 16px;
          }
          .agent-card__repo {
            color: var(--accent);
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.06em;
            text-transform: uppercase;
          }
          .agent-card h2,
          .empty-state h2 {
            margin: 6px 0 0;
            font-size: 21px;
            letter-spacing: -0.03em;
          }
          .status-pill {
            display: inline-flex;
            align-items: center;
            padding: 8px 12px;
            border-radius: 999px;
            background: var(--success-soft);
            color: var(--success);
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.04em;
            text-transform: uppercase;
          }
          .status-pill--alert {
            background: var(--alert-soft);
            color: var(--alert);
          }
          .agent-grid {
            margin: 0;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 14px;
          }
          .agent-grid div {
            min-width: 0;
          }
          dt {
            margin: 0 0 6px;
            color: var(--muted);
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }
          dd {
            margin: 0;
            line-height: 1.45;
            word-break: break-word;
          }
          .empty-state p {
            margin: 8px 0 0;
            color: var(--muted);
          }
          code {
            font-family: "SF Mono", "Menlo", monospace;
            font-size: 12px;
          }
        </style>
      </head>
      <body>
        <header>
          <div>
            <h1>Conductor</h1>
            <p class="subtitle">
              This view reads Conductor's local SQLite state, shows active sessions, and lists idle sessions that are waiting on the user.
            </p>
          </div>
          <div class="meta">
            Last refreshed<br />
            <strong>${refreshedLabel}</strong>
            <code>${escapeHtml(dbPath)}</code>
          </div>
        </header>
        <div class="summary">${activeAgents.length} active · ${idleAgents.length} idle · ${unreadAgents.length} unread</div>
        ${errorBanner}
        <section class="sections">${sections}</section>
      </body>
    </html>
  `
}

function sessionSectionMarkup({
  title,
  description,
  sessions,
  pillClassName,
  pillLabel,
  emptyTitle,
  emptyCopy,
}) {
  const cards = sessions.length
    ? sessions.map((session) => {
      const repo = escapeHtml(session.repo || 'Unknown repo')
      const workspace = escapeHtml(session.workspace || 'Unknown workspace')
      const branch = escapeHtml(session.branch || 'No branch recorded')
      const sessionTitle = escapeHtml(session.title || 'Untitled session')
      const model = escapeHtml(session.model || 'unknown')
      const agentType = escapeHtml(session.agentType || 'unknown')
      const updatedAt = escapeHtml(session.updatedAt || 'unknown')
      const unreadCount = escapeHtml(session.unreadCount || 0)
      const workspaceId = escapeHtml(session.workspaceId || '')
      const sessionId = escapeHtml(session.sessionId || '')

      return `
        <article class="agent-card">
          <div class="agent-card__top">
            <div>
              <div class="agent-card__repo">${repo}</div>
              <h2>${sessionTitle}</h2>
            </div>
            <span class="${pillClassName}">${pillLabel}</span>
          </div>
          <dl class="agent-grid">
            <div>
              <dt>Workspace</dt>
              <dd>${workspace}</dd>
            </div>
            <div>
              <dt>Branch</dt>
              <dd>${branch}</dd>
            </div>
            <div>
              <dt>Agent</dt>
              <dd>${agentType}</dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>${model}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>${updatedAt}</dd>
            </div>
            <div>
              <dt>Unread</dt>
              <dd>${unreadCount}</dd>
            </div>
            <div>
              <dt>IDs</dt>
              <dd>${workspaceId}<br />${sessionId}</dd>
            </div>
          </dl>
        </article>
      `
    }).join('')
    : `
      <div class="empty-state">
        <h2>${emptyTitle}</h2>
        <p>${emptyCopy}</p>
      </div>
    `

  return `
    <section>
      <div class="section-heading">
        <div>
          <h2>${escapeHtml(title)}</h2>
          <p>${escapeHtml(description)}</p>
        </div>
      </div>
      <div class="agent-list">${cards}</div>
    </section>
  `
}

function escapeHtml(value) {
  return `${value ?? ''}`
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function serializeForInlineScript(value) {
  return JSON.stringify(value)
    .replaceAll('</script', '<\\/script')
    .replaceAll('<!--', '<\\!--')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')
}

function isPromptPathAllowed(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') {
    return false
  }

  const resolvedTarget = path.resolve(targetPath)
  return PROMPT_SOURCE_CONFIGS.some((source) => {
    const resolvedRoot = path.resolve(source.rootPath)
    return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)
  })
}

function createTrayIconDataUrl() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
      <path fill="black" d="M4 3.25L16.5 11L4 18.75V3.25Z"/>
      <path fill="black" d="M14.9 4.7H16.1V7.3H18.7V8.5H16.1V11.1H14.9V8.5H12.3V7.3H14.9Z"/>
    </svg>
  `

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

ipcMain.handle('shell:get-state', async () => ({
  activeApp,
  apps: allAppStates(),
  githubIssues: githubIssuesShellState(),
  globalShortcut: GLOBAL_TOGGLE_SHORTCUT,
  updateOffer: currentUpdateOffer(),
}))

ipcMain.on('shell:set-active-app', (_event, appId) => {
  setActiveApp(appId)
})

ipcMain.on('shell:set-content-bounds', (_event, bounds) => {
  updateContentBounds(bounds)
})

ipcMain.on('shell:navigate', (_event, value) => {
  if (activeApp !== 'browser') {
    setActiveApp('browser')
  }
  navigateBrowser(value)
})

ipcMain.on('shell:open-app-url', (_event, appId, url) => {
  if (!appId || typeof url !== 'string') {
    return
  }

  openAppURL(appId, url)
})

ipcMain.on('shell:go-back', () => {
  const browserView = views.get('browser')
  if (browserView && browserView.webContents.navigationHistory.canGoBack()) {
    browserView.webContents.navigationHistory.goBack()
  }
})

ipcMain.on('shell:go-forward', () => {
  const browserView = views.get('browser')
  if (browserView && browserView.webContents.navigationHistory.canGoForward()) {
    browserView.webContents.navigationHistory.goForward()
  }
})

ipcMain.on('shell:reload', () => {
  const browserView = views.get('browser')
  if (browserView) {
    browserView.webContents.reload()
  }
})

ipcMain.on('shell:toggle-window', () => {
  toggleWindowVisibility()
})

ipcMain.on('backdrop:dismiss', () => {
  hideWindow()
})

ipcMain.on('shell:open-external', (_event, url) => {
  shell.openExternal(url)
})

ipcMain.handle('local-app:copy-text', async (_event, value) => {
  clipboard.writeText(`${value || ''}`)
  return true
})

ipcMain.on('local-app:refresh', (_event, appId) => {
  if (!appId || typeof appId !== 'string') {
    return
  }

  const appConfig = apps.get(appId)
  if (!appConfig || appConfig.type !== 'local') {
    return
  }

  localAppSignatures.delete(appId)
  refreshLocalAppView(appId)
  emitState()
})

ipcMain.on('local-app:reveal-path', (_event, targetPath) => {
  if (!isPromptPathAllowed(targetPath)) {
    return
  }

  shell.showItemInFolder(targetPath)
})

ipcMain.on('hosted-app:unread-count', (_event, payload) => {
  const appId = typeof payload?.appId === 'string' ? payload.appId : ''
  if (!appId || !apps.has(appId)) {
    return
  }

  setHostedAppUnreadCount(appId, payload?.unreadCount)
})

app.on('before-quit', () => {
  isQuitting = true
})

app.whenReady().then(() => {
  if (app.dock) {
    app.dock.hide()
  }

  mainWindow = createShellWindow()
  backdropWindow = createBackdropWindow()
  companionWindow = createCompanionWindow()
  createViews()
  createTray()
  configureAutoUpdater()
  registerShortcuts()
  startConductorRefresh()
  startReleaseChecks()
  void refreshGitHubIssuesRepos()
  setActiveApp(activeApp)
  showWindow()
  showCompanion()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', (event) => {
  event.preventDefault()
})
