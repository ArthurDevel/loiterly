const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const util = require('node:util')
const { execFileSync, spawn } = require('node:child_process')
const readline = require('node:readline')
const { autoUpdater } = require('electron-updater')
const { compareVersions, releaseVersionFromPayload } = require('./updater/version.cjs')
const {
  canTriggerCompanionPing,
  isCompanionSuppressed: computeCompanionSuppressed,
  normalizeCompanionInputEvent,
  shouldAutoReleaseTypingSuppression,
  shouldReleaseTypingSuppression,
  shouldTriggerUnreadPing,
} = require('./companion/state.cjs')
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
const IS_MAC = process.platform === 'darwin'
const IS_WINDOWS = process.platform === 'win32'
const GLOBAL_TOGGLE_SHORTCUT = 'CommandOrControl+Shift+L'
const GLOBAL_TOGGLE_SHORTCUT_LABEL = IS_MAC ? '(cmd + shift + l)' : '(ctrl + shift + l)'
const LOGIN_ITEM_LAUNCH_ARG = '--loiterly-login-start'
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
const WINDOWS_APPDATA_PATH = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
const WINDOWS_LOCAL_APPDATA_PATH = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
const CONDUCTOR_DB_PATH = resolveConductorDbPath()
const CLAUDE_HOME_PATH = path.join(os.homedir(), '.claude')
const CLAUDE_SESSIONS_PATH = path.join(CLAUDE_HOME_PATH, 'sessions')
const CLAUDE_PROJECTS_PATH = path.join(CLAUDE_HOME_PATH, 'projects')
const CLAUDE_TRANSCRIPT_TAIL_BYTES = 128 * 1024
const GIT_METADATA_CACHE_TTL_MS = 15 * 1000
const MAX_TRANSCRIPT_MESSAGES = 120
const COMPANION_KEYBOARD_IDLE_MS = 900
const MAX_MAIN_LOG_SIZE_BYTES = 2 * 1024 * 1024
const LOG_DIR_PATH = resolveLogDirPath()
const MAIN_LOG_PATH = path.join(LOG_DIR_PATH, 'main.log')
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
    iconPath: '../assets/app-icons/notion.ico',
    partition: SHARED_REMOTE_PARTITION,
    initialURL: 'https://www.notion.so',
    showAddressBar: false,
    showNavigation: false,
  },
  {
    id: 'siliconmania',
    label: 'Silicon Mania',
    type: 'remote',
    iconPath: '../assets/app-icons/siliconmania.ico',
    partition: SHARED_REMOTE_PARTITION,
    initialURL: 'https://www.siliconmania.tv/weekly',
    showAddressBar: false,
    showNavigation: false,
  },
  {
    id: 'gmail',
    label: 'Gmail',
    type: 'remote',
    iconPath: '../assets/app-icons/gmail.ico',
    partition: SHARED_REMOTE_PARTITION,
    initialURL: 'https://mail.google.com',
    showAddressBar: false,
    showNavigation: false,
  },
  {
    id: 'github',
    label: 'GitHub',
    type: 'remote',
    iconPath: '../assets/app-icons/github.svg',
    partition: SHARED_REMOTE_PARTITION,
    initialURL: 'https://github.com',
    showAddressBar: false,
    showNavigation: false,
  },
  {
    id: 'github-issues',
    label: 'GitHub Issues',
    type: 'remote',
    iconPath: '../assets/app-icons/github.svg',
    partition: SHARED_REMOTE_PARTITION,
    initialURL: `https://github.com/${GITHUB_ISSUES_OWNER}/${GITHUB_ISSUES_DEFAULT_REPO}/issues`,
    showAddressBar: false,
    showNavigation: false,
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    type: 'remote',
    iconPath: '../assets/app-icons/linkedin.ico',
    partition: SHARED_REMOTE_PARTITION,
    initialURL: 'https://www.linkedin.com/messaging/',
    showAddressBar: false,
    showNavigation: false,
  },
  {
    id: 'instagram',
    label: 'Instagram',
    type: 'remote',
    iconPath: '../assets/app-icons/instagram.ico',
    partition: SHARED_REMOTE_PARTITION,
    initialURL: 'https://www.instagram.com',
    showAddressBar: false,
    showNavigation: false,
  },
  {
    id: 'openpaperdigest',
    label: 'Open Paper Digest',
    type: 'remote',
    iconPath: '../assets/app-icons/openpaperdigest.svg',
    partition: SHARED_REMOTE_PARTITION,
    initialURL: 'https://www.openpaperdigest.com',
    showAddressBar: false,
    showNavigation: false,
  },
  {
    id: 'twitter',
    label: 'X',
    type: 'remote',
    iconPath: '../assets/app-icons/x.svg',
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
    label: 'Agents',
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
let lastCompanionUnreadCount = null
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
const loadedHostedAppIds = new Set()
const localAppSignatures = new Map()
const localAppScrollPositions = new Map()
const localAppAccessGateIds = new Set(['prompts', 'conductor'])
const localAppAccessStates = new Map(
  Array.from(localAppAccessGateIds, (appId) => [appId, {
    granted: !IS_MAC,
    requested: !IS_MAC,
    lastError: '',
  }])
)
const popupWindows = new Set()
const configuredPermissionPartitions = new Set()
let githubIssuesReposState = {
  owner: GITHUB_ISSUES_OWNER,
  repos: [],
  isLoading: false,
  error: '',
}
let githubIssuesReposPromise = null
const claudeTranscriptPathCache = new Map()
const gitMetadataCache = new Map()
let companionInputMonitorProcess = null
let companionTypingReleaseTimeout = null
let mainLogStream = null
let isConsoleLoggingInstalled = false
let isReportingLoggerFailure = false
let isCompanionInputMonitorUnavailable = false
let sqliteModuleLoadAttempted = false
let sqliteDatabaseSync = null

const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
}

function launchAtLoginSupported() {
  return (IS_MAC || IS_WINDOWS) && app.isPackaged
}

function launchAtLoginPreferencePath() {
  return path.join(app.getPath('userData'), 'launch-at-login.json')
}

function readLaunchAtLoginPreference() {
  if (!launchAtLoginSupported()) {
    return null
  }

  const preferencePath = launchAtLoginPreferencePath()
  if (!fs.existsSync(preferencePath)) {
    return null
  }

  try {
    const payload = JSON.parse(fs.readFileSync(preferencePath, 'utf8'))
    return typeof payload?.enabled === 'boolean' ? payload.enabled : null
  } catch {
    return null
  }
}

function writeLaunchAtLoginPreference(enabled) {
  if (!launchAtLoginSupported()) {
    return
  }

  const preferencePath = launchAtLoginPreferencePath()
  fs.mkdirSync(path.dirname(preferencePath), { recursive: true })
  fs.writeFileSync(preferencePath, JSON.stringify({ enabled: Boolean(enabled) }, null, 2))
}

function currentLaunchAtLoginEnabled() {
  if (!launchAtLoginSupported()) {
    return false
  }

  return Boolean(app.getLoginItemSettings().openAtLogin)
}

function setLaunchAtLoginEnabled(enabled, options = {}) {
  const shouldPersist = options.persist !== false
  if (!launchAtLoginSupported()) {
    return false
  }

  const nextEnabled = Boolean(enabled)
  app.setLoginItemSettings({
    openAtLogin: nextEnabled,
    openAsHidden: true,
    args: nextEnabled ? [LOGIN_ITEM_LAUNCH_ARG] : [],
  })

  if (shouldPersist) {
    writeLaunchAtLoginPreference(nextEnabled)
  }

  refreshTrayMenu()
  return currentLaunchAtLoginEnabled()
}

function initializeLaunchAtLoginPreference() {
  if (!launchAtLoginSupported()) {
    return
  }

  const savedPreference = readLaunchAtLoginPreference()
  if (typeof savedPreference === 'boolean') {
    setLaunchAtLoginEnabled(savedPreference, { persist: false })
    return
  }

  setLaunchAtLoginEnabled(true)
}

function toggleLaunchAtLogin() {
  setLaunchAtLoginEnabled(!currentLaunchAtLoginEnabled())
}

function shouldStartHiddenAtLaunch() {
  return process.argv.includes(LOGIN_ITEM_LAUNCH_ARG)
}

function resolveLogDirPath() {
  if (IS_MAC) {
    return path.join(os.homedir(), 'Library', 'Logs', 'Loiterly')
  }

  if (IS_WINDOWS) {
    return path.join(WINDOWS_LOCAL_APPDATA_PATH, 'Loiterly', 'logs')
  }

  return path.join(os.homedir(), '.loiterly', 'logs')
}

function candidateConductorDbPaths() {
  const configuredPath = `${process.env.LOITERLY_CONDUCTOR_DB_PATH || ''}`.trim()
  const candidates = []

  if (configuredPath) {
    candidates.push(configuredPath)
  }

  if (IS_MAC) {
    candidates.push(
      path.join(os.homedir(), 'Library', 'Application Support', 'com.conductor.app', 'conductor.db')
    )
  } else if (IS_WINDOWS) {
    candidates.push(
      path.join(WINDOWS_APPDATA_PATH, 'com.conductor.app', 'conductor.db'),
      path.join(WINDOWS_LOCAL_APPDATA_PATH, 'com.conductor.app', 'conductor.db'),
      path.join(WINDOWS_APPDATA_PATH, 'Conductor', 'conductor.db'),
      path.join(WINDOWS_LOCAL_APPDATA_PATH, 'Conductor', 'conductor.db')
    )
  } else {
    candidates.push(
      path.join(os.homedir(), '.config', 'com.conductor.app', 'conductor.db'),
      path.join(os.homedir(), '.config', 'Conductor', 'conductor.db')
    )
  }

  return [...new Set(candidates.filter(Boolean))]
}

function resolveConductorDbPath() {
  const candidates = candidateConductorDbPaths()
  const existingPath = candidates.find((candidate) => fs.existsSync(candidate))

  return existingPath || candidates[0] || ''
}

function loadDatabaseSync() {
  if (sqliteModuleLoadAttempted) {
    return sqliteDatabaseSync
  }

  sqliteModuleLoadAttempted = true

  try {
    ;({ DatabaseSync: sqliteDatabaseSync } = require('node:sqlite'))
  } catch (error) {
    console.warn('[conductor] unable to load node:sqlite', error)
    sqliteDatabaseSync = null
  }

  return sqliteDatabaseSync
}

function readJsonPayloadFromDatabase(dbPath, sql) {
  if (!dbPath || !fs.existsSync(dbPath)) {
    return '[]'
  }

  if (!IS_WINDOWS) {
    const raw = execFileSync('sqlite3', [dbPath, sql], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()

    return raw || '[]'
  }

  const DatabaseSync = loadDatabaseSync()
  if (!DatabaseSync) {
    throw new Error('node:sqlite is unavailable for Windows Conductor queries.')
  }

  const database = new DatabaseSync(dbPath, { readOnly: true })

  try {
    const row = database.prepare(sql).get()
    return typeof row?.payload === 'string' && row.payload ? row.payload : '[]'
  } finally {
    database.close()
  }
}

function platformInstallInstructions() {
  if (IS_WINDOWS) {
    return 'Download the newest installer and run it.'
  }

  if (IS_MAC) {
    return 'Download the newest build and replace the app in Applications.'
  }

  return 'Download the newest build and install it manually.'
}

function preferredReleaseAssetSuffix() {
  if (IS_MAC) {
    if (process.arch === 'arm64') {
      return '-arm64.dmg'
    }

    if (process.arch === 'x64') {
      return '-x64.dmg'
    }

    return '.dmg'
  }

  if (IS_WINDOWS) {
    return `-${process.arch}.exe`
  }

  return '.zip'
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

  const fallbackExtensions = IS_WINDOWS
    ? ['.exe', '.msi', '.zip']
    : IS_MAC
      ? ['.dmg', '.zip']
      : ['.AppImage', '.deb', '.rpm', '.zip']

  for (const extension of fallbackExtensions) {
    const match = assets.find((asset) => typeof asset?.name === 'string' && asset.name.endsWith(extension))
    if (match) {
      return match
    }
  }

  return null
}

function resolveCompanionMonitorLaunchSpec() {
  if (IS_MAC) {
    const monitorPath = path.join(__dirname, 'native', 'companion-input-monitor.swift')
    if (!fs.existsSync(monitorPath)) {
      return null
    }

    return {
      command: 'swift',
      args: [monitorPath],
      description: monitorPath,
    }
  }

  if (IS_WINDOWS) {
    const monitorPath = app.isPackaged
      ? path.join(process.resourcesPath, 'native', 'bin', 'windows', 'companion-input-monitor.exe')
      : path.join(__dirname, 'native', 'bin', 'windows', 'companion-input-monitor.exe')

    if (!fs.existsSync(monitorPath)) {
      return null
    }

    return {
      command: monitorPath,
      args: [],
      description: monitorPath,
    }
  }

  return null
}

function hideWindowControls(window) {
  if (typeof window?.setWindowButtonVisibility === 'function') {
    window.setWindowButtonVisibility(false)
  }
}

function formatLogValue(value) {
  if (value instanceof Error) {
    return value.stack || `${value.name}: ${value.message}`
  }

  if (typeof value === 'string') {
    return value
  }

  return util.inspect(value, {
    depth: 5,
    colors: false,
    breakLength: 120,
    maxArrayLength: 50,
  })
}

function createMainLogLine(level, args) {
  return `${new Date().toISOString()} [${level}] ${args.map(formatLogValue).join(' ')}\n`
}

function appendMainLogLineSync(line) {
  fs.mkdirSync(LOG_DIR_PATH, { recursive: true })
  fs.appendFileSync(MAIN_LOG_PATH, line, 'utf8')
}

function reportLoggerFailure(message, error) {
  if (isReportingLoggerFailure) {
    return
  }

  isReportingLoggerFailure = true

  try {
    appendMainLogLineSync(createMainLogLine('LOGGER', [message, error]))
  } catch {}

  isReportingLoggerFailure = false
}

function safeOriginalConsoleCall(level, args) {
  try {
    originalConsole[level](...args)
  } catch (error) {
    // Stdio can disappear during app teardown when launched from a terminal.
    if (error?.code === 'EIO' || error?.code === 'EPIPE' || error?.code === 'ERR_STREAM_DESTROYED') {
      reportLoggerFailure(`suppressed ${level} console write failure`, error)
      return
    }

    reportLoggerFailure(`original console ${level} failed`, error)
  }
}

function rotateMainLogIfNeeded() {
  try {
    const stats = fs.statSync(MAIN_LOG_PATH)
    if (stats.size < MAX_MAIN_LOG_SIZE_BYTES) {
      return
    }

    const archivePath = `${MAIN_LOG_PATH}.1`
    fs.rmSync(archivePath, { force: true })
    fs.renameSync(MAIN_LOG_PATH, archivePath)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      reportLoggerFailure('failed to rotate main log', error)
    }
  }
}

function ensureMainLogStream() {
  if (mainLogStream) {
    return mainLogStream
  }

  fs.mkdirSync(LOG_DIR_PATH, { recursive: true })
  rotateMainLogIfNeeded()
  const stream = fs.createWriteStream(MAIN_LOG_PATH, { flags: 'a' })
  stream.on('error', (error) => {
    if (mainLogStream === stream) {
      mainLogStream = null
    }
    reportLoggerFailure('log stream error', error)
  })
  mainLogStream = stream
  return mainLogStream
}

function writeMainLog(level, args) {
  const line = createMainLogLine(level, args)

  try {
    const stream = ensureMainLogStream()
    stream.write(line)
  } catch (error) {
    try {
      appendMainLogLineSync(line)
    } catch (fallbackError) {
      reportLoggerFailure('failed to write log line', fallbackError)
      return
    }

    reportLoggerFailure('failed to write log line via stream; wrote synchronously instead', error)
  }
}

function installConsoleLogging() {
  if (isConsoleLoggingInstalled) {
    return
  }

  console.log = (...args) => {
    writeMainLog('INFO', args)
    safeOriginalConsoleCall('log', args)
  }

  console.info = (...args) => {
    writeMainLog('INFO', args)
    safeOriginalConsoleCall('info', args)
  }

  console.warn = (...args) => {
    writeMainLog('WARN', args)
    safeOriginalConsoleCall('warn', args)
  }

  console.error = (...args) => {
    writeMainLog('ERROR', args)
    safeOriginalConsoleCall('error', args)
  }

  isConsoleLoggingInstalled = true
  writeMainLog('INFO', ['Loiterly logging initialized', { path: MAIN_LOG_PATH }])
}

function closeMainLog() {
  if (!mainLogStream) {
    return
  }

  mainLogStream.end()
  mainLogStream = null
}

installConsoleLogging()

process.on('warning', (warning) => {
  writeMainLog('WARN', ['process warning', warning])
})

process.on('unhandledRejection', (reason) => {
  writeMainLog('FATAL', ['unhandledRejection', reason])
})

process.on('uncaughtException', (error) => {
  writeMainLog('FATAL', ['uncaughtException', error])
})

process.on('exit', (code) => {
  writeMainLog('INFO', ['process exit', { code }])
  closeMainLog()
})

function handleCompanionKeyboardActivity() {
  isCompanionSuppressedForTyping = true
  syncCompanionVisibility()
  scheduleCompanionTypingRelease()
}

function handleCompanionPointerActivity() {
  clearCompanionTypingRelease()

  if (!isCompanionSuppressedForTyping) {
    return
  }

  if (shouldReleaseTypingSuppression('pointer')) {
    isCompanionSuppressedForTyping = false
    syncCompanionVisibility()
  }
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

function clearCompanionTypingRelease() {
  if (!companionTypingReleaseTimeout) {
    return
  }

  clearTimeout(companionTypingReleaseTimeout)
  companionTypingReleaseTimeout = null
}

function scheduleCompanionTypingRelease() {
  clearCompanionTypingRelease()

  const startedAt = Date.now()
  companionTypingReleaseTimeout = setTimeout(() => {
    companionTypingReleaseTimeout = null

    if (!shouldAutoReleaseTypingSuppression(Date.now() - startedAt, COMPANION_KEYBOARD_IDLE_MS)) {
      return
    }

    if (!isCompanionSuppressedForTyping) {
      return
    }

    isCompanionSuppressedForTyping = false
    syncCompanionVisibility()
  }, COMPANION_KEYBOARD_IDLE_MS)
}

function startCompanionInputMonitor() {
  if (companionInputMonitorProcess || isCompanionInputMonitorUnavailable) {
    return
  }

  const launchSpec = resolveCompanionMonitorLaunchSpec()
  if (!launchSpec) {
    isCompanionInputMonitorUnavailable = true
    console.warn('[companion-input-monitor] helper unavailable for this platform or build')
    return
  }

  const child = spawn(launchSpec.command, launchSpec.args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  companionInputMonitorProcess = child

  const stdout = readline.createInterface({ input: child.stdout })
  stdout.on('line', (line) => {
    const eventType = normalizeCompanionInputEvent(line)
    if (eventType === 'keyboard') {
      handleCompanionKeyboardActivity()
      return
    }

    if (eventType === 'pointer') {
      handleCompanionPointerActivity()
    }
  })

  child.stderr.on('data', (chunk) => {
    const message = `${chunk || ''}`.trim()
    if (message) {
      console.error(`[companion-input-monitor] ${message}`)
    }
  })

  child.on('error', (error) => {
    console.error('[companion-input-monitor] failed to start', error)
    if (error?.code === 'ENOENT') {
      isCompanionInputMonitorUnavailable = true
    }
  })

  child.on('exit', () => {
    stdout.close()
    console.warn('[companion-input-monitor] exited')
    if (companionInputMonitorProcess === child) {
      companionInputMonitorProcess = null
      if (!isQuitting && app.isReady() && !isCompanionInputMonitorUnavailable) {
        setTimeout(startCompanionInputMonitor, 1000)
      }
    }
  })
}

function stopCompanionInputMonitor() {
  if (!companionInputMonitorProcess) {
    return
  }

  companionInputMonitorProcess.kill()
  companionInputMonitorProcess = null
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
  hideWindowControls(window)
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
  hideWindowControls(window)
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
  if (IS_MAC) {
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }
  window.setIgnoreMouseEvents(true, { forward: true })
  hideWindowControls(window)
  window.loadFile(path.join(__dirname, 'companion', 'index.html'))
  window.webContents.on('did-finish-load', () => {
    updateCompanionUnreadBadge()
  })

  return window
}

function createTray() {
  const image = nativeImage.createFromPath(path.join(__dirname, 'assets', 'loiterly-tray-template.png'))
  image.setTemplateImage(true)
  const trayImage = image.resize({ width: 18, height: 18 })
  trayImage.setTemplateImage(true)

  tray = new Tray(trayImage)
  tray.setToolTip('Loiterly')
  refreshTrayMenu()
}

function updaterSupported() {
  return IS_MAC || IS_WINDOWS
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

function currentUpdateOffer() {
  if (!latestReleaseInfo.available) {
    return null
  }

  return {
    version: latestReleaseInfo.version,
    downloadURL: latestReleaseInfo.downloadURL,
    releaseURL: latestReleaseInfo.releaseURL,
    buttonLabel: 'Download',
    summary: 'Update available',
    detail: `Version ${latestReleaseInfo.version}`,
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

  const loiterlyVisibilityLabel = mainWindow && mainWindow.isVisible() ? 'Hide Loiterly' : 'Show Loiterly'
  const canToggleLaunchAtLogin = launchAtLoginSupported()
  const menu = Menu.buildFromTemplate([
    {
      label: `${loiterlyVisibilityLabel} ${GLOBAL_TOGGLE_SHORTCUT_LABEL}`,
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
    {
      label: 'Launch at Login',
      type: 'checkbox',
      checked: currentLaunchAtLoginEnabled(),
      enabled: canToggleLaunchAtLogin,
      click: () => {
        toggleLaunchAtLogin()
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
        detail: `Use the Download Latest Release item in the tray menu to install the newest build. ${platformInstallInstructions()}`,
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
  contents.on('did-finish-load', () => {
    enforceHostedAppLocation(appConfig, contents)
    syncHostedAppNavigationGuards(appConfig, contents)
    syncHostedAppStyles(appConfig, contents)
    syncHostedAppObservers(appConfig, contents)
  })
  contents.on('did-navigate-in-page', () => {
    syncHostedAppNavigationGuards(appConfig, contents)
    syncHostedAppStyles(appConfig, contents)
    syncHostedAppObservers(appConfig, contents)
  })

  return view
}

function ensureHostedAppLoaded(appId, targetURL = null) {
  const appConfig = apps.get(appId)
  if (!appConfig || appConfig.type !== 'remote' || loadedHostedAppIds.has(appId)) {
    return false
  }

  const view = views.get(appId)
  if (!view) {
    return false
  }

  loadedHostedAppIds.add(appId)
  view.webContents.loadURL(targetURL || hostedAppHomeURLs.get(appId) || appConfig.initialURL)
  return true
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

  if (appConfig.id === 'siliconmania') {
    return isSiliconManiaWeeklyRoute(target)
  }

  if (appConfig.id === 'linkedin') {
    return isLinkedInMessagingRoute(target)
  }

  return true
}

function isSiliconManiaWeeklyRoute(target) {
  try {
    const url = new URL(target)
    const hostname = url.hostname.toLowerCase()
    const pathname = url.pathname.toLowerCase()

    if (hostname !== 'siliconmania.tv' && hostname !== 'www.siliconmania.tv') {
      return false
    }

    return pathname === '/weekly' || pathname === '/weekly/'
  } catch {
    return false
  }
}

function syncHostedAppNavigationGuards(appConfig, contents) {
  if (!appConfig || !contents || contents.isDestroyed()) {
    return
  }

  if (appConfig.id !== 'siliconmania') {
    return
  }

  const currentURL = contents.getURL()
  if (!currentURL || !isSiliconManiaWeeklyRoute(currentURL)) {
    return
  }

  contents.executeJavaScript(siliconManiaNavigationGuardScript(), true).catch(() => {})
}

function siliconManiaNavigationGuardScript() {
  return `
    (() => {
      if (window.__loiterlySiliconManiaGuardInstalled) {
        return
      }

      const isAllowedUrl = (value) => {
        try {
          const url = new URL(value, window.location.href)
          const hostname = url.hostname.toLowerCase()
          const pathname = url.pathname.toLowerCase()

          if (hostname !== 'siliconmania.tv' && hostname !== 'www.siliconmania.tv') {
            return false
          }

          return pathname === '/weekly' || pathname === '/weekly/'
        } catch {
          return false
        }
      }

      const intercept = (event) => {
        if (event.defaultPrevented) {
          return
        }

        const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
        if (!anchor) {
          return
        }

        const href = anchor.getAttribute('href')
        if (!href) {
          return
        }

        const targetUrl = new URL(href, window.location.href).toString()
        if (isAllowedUrl(targetUrl)) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        window.open(targetUrl, '_blank', 'noopener')
      }

      document.addEventListener('click', intercept, true)
      document.addEventListener('auxclick', intercept, true)
      window.__loiterlySiliconManiaGuardInstalled = true
    })()
  `
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

function shouldGateLocalAppAccess(appId) {
  return IS_MAC && localAppAccessGateIds.has(appId)
}

function localAppAccessState(appId) {
  if (!shouldGateLocalAppAccess(appId)) {
    return {
      granted: true,
      requested: true,
      lastError: '',
    }
  }

  return localAppAccessStates.get(appId) || {
    granted: false,
    requested: false,
    lastError: '',
  }
}

function setLocalAppAccessState(appId, nextState) {
  if (!shouldGateLocalAppAccess(appId)) {
    return localAppAccessState(appId)
  }

  const currentState = localAppAccessState(appId)
  const resolvedState = {
    ...currentState,
    ...nextState,
  }
  localAppAccessStates.set(appId, resolvedState)
  return resolvedState
}

function findPermissionError(messages) {
  if (!Array.isArray(messages)) {
    return ''
  }

  const match = messages.find((message) => /\b(EACCES|EPERM)\b|permission denied|operation not permitted/i.test(`${message || ''}`))
  return match ? `${match}` : ''
}

function requestLocalAppAccess(appId) {
  const currentState = localAppAccessState(appId)
  if (!shouldGateLocalAppAccess(appId)) {
    return currentState
  }

  let nextState = {
    granted: true,
    requested: true,
    lastError: '',
  }

  if (appId === 'prompts') {
    const snapshot = loadPromptLibrarySnapshot()
    const permissionError = findPermissionError(snapshot.sources.map((source) => source.error).filter(Boolean))
    if (permissionError) {
      nextState = {
        granted: false,
        requested: true,
        lastError: permissionError,
      }
    }
  } else if (appId === 'conductor') {
    const snapshot = loadConductorSnapshot()
    const permissionError = findPermissionError(snapshot.errors)
    if (permissionError) {
      nextState = {
        granted: false,
        requested: true,
        lastError: permissionError,
      }
    }
  }

  return setLocalAppAccessState(appId, nextState)
}

function maybeLoadConductorSnapshot() {
  return localAppAccessState('conductor').granted ? loadConductorSnapshot() : null
}

function localAppAccessMarkup(appId, accessState) {
  const appConfig = {
    prompts: {
      title: 'Prompts',
      description: 'Loiterly can browse your local prompt folders after you explicitly allow it.',
      details: 'This view reads from ~/.codex/prompts, ~/.claude/commands, and ~/.claude/agents.',
      caution: 'macOS may ask for folder access the first time this runs, especially if those folders or linked files live inside protected locations.',
      buttonLabel: 'Continue and Request Access',
    },
    conductor: {
      title: 'Agents',
      description: 'Loiterly can inspect local Conductor and Claude session data after you explicitly allow it.',
      details: 'This view reads Conductor state, Claude CLI logs, and may inspect workspace git metadata to label sessions.',
      caution: 'macOS may ask for Documents access here if your workspaces live in protected folders like Documents or Desktop.',
      buttonLabel: 'Continue and Request Access',
    },
  }[appId]

  if (!appConfig) {
    return ''
  }

  const errorMessage = accessState.requested && accessState.lastError
    ? `
      <div class="access-card__status access-card__status--error">
        ${escapeHtml(accessState.lastError)}
      </div>
    `
    : (
      accessState.requested
        ? `
      <div class="access-card__status">
        Access still is not available. After allowing it in the macOS dialog, click the button again.
      </div>
    `
        : ''
    )

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${escapeHtml(appConfig.title)}</title>
        <style>
          :root {
            color-scheme: light;
            --bg: #edf2f7;
            --panel: rgba(255, 255, 255, 0.82);
            --panel-strong: rgba(255, 255, 255, 0.94);
            --border: rgba(147, 163, 184, 0.24);
            --text: #172030;
            --muted: #617086;
            --accent: #2e68db;
            --accent-strong: #1f53b8;
            --accent-soft: rgba(74, 132, 245, 0.12);
            --danger: #d84c4c;
            --danger-soft: rgba(216, 76, 76, 0.12);
          }
          * {
            box-sizing: border-box;
          }
          body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            padding: 28px;
            background:
              radial-gradient(circle at top left, rgba(255,255,255,0.86), rgba(255,255,255,0) 34%),
              linear-gradient(180deg, #fbfcfe 0%, var(--bg) 100%);
            color: var(--text);
            font-family: "SF Pro Display", "Helvetica Neue", sans-serif;
          }
          .access-card {
            width: min(720px, 100%);
            padding: 28px;
            border-radius: 28px;
            background: linear-gradient(180deg, var(--panel-strong), var(--panel));
            border: 1px solid var(--border);
            box-shadow:
              0 18px 44px rgba(103, 120, 146, 0.12),
              inset 0 1px 0 rgba(255,255,255,0.8);
          }
          .access-card__eyebrow {
            display: inline-flex;
            padding: 8px 12px;
            border-radius: 999px;
            background: var(--accent-soft);
            color: var(--accent);
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }
          h1 {
            margin: 16px 0 10px;
            font-size: 32px;
            letter-spacing: -0.04em;
          }
          p {
            margin: 0;
            color: var(--muted);
            line-height: 1.55;
          }
          .access-card__details {
            margin-top: 18px;
            padding: 18px;
            border-radius: 18px;
            background: rgba(255, 255, 255, 0.6);
            border: 1px solid rgba(147, 163, 184, 0.18);
          }
          .access-card__details strong {
            display: block;
            margin-bottom: 6px;
            color: var(--text);
          }
          .access-card__status {
            margin-top: 18px;
            padding: 14px 16px;
            border-radius: 16px;
            background: rgba(255, 255, 255, 0.7);
            border: 1px solid rgba(147, 163, 184, 0.18);
            color: var(--muted);
          }
          .access-card__status--error {
            background: var(--danger-soft);
            border-color: rgba(216, 76, 76, 0.18);
            color: var(--danger);
          }
          .access-card__actions {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-top: 22px;
          }
          button {
            border: 0;
            border-radius: 14px;
            padding: 12px 18px;
            background: var(--accent);
            color: white;
            font: inherit;
            font-weight: 700;
            cursor: pointer;
          }
          button:hover {
            background: var(--accent-strong);
          }
          button[disabled] {
            opacity: 0.7;
            cursor: wait;
          }
          code {
            font-family: "SF Mono", "Menlo", monospace;
            font-size: 12px;
          }
        </style>
      </head>
      <body>
        <main class="access-card">
          <div class="access-card__eyebrow">Local Access</div>
          <h1>${escapeHtml(appConfig.title)}</h1>
          <p>${escapeHtml(appConfig.description)}</p>
          <div class="access-card__details">
            <strong>Why this needs permission</strong>
            <p>${escapeHtml(appConfig.details)}</p>
            <p style="margin-top: 10px;">${escapeHtml(appConfig.caution)}</p>
          </div>
          ${errorMessage}
          <div class="access-card__actions">
            <button id="request-access" type="button">${escapeHtml(appConfig.buttonLabel)}</button>
          </div>
        </main>
        <script>
          const requestButton = document.getElementById('request-access')
          requestButton.addEventListener('click', async () => {
            requestButton.disabled = true
            requestButton.textContent = 'Requesting Access...'
            try {
              await window.loiterlyLocalApp.requestAccess(${JSON.stringify(appId)})
            } finally {
              requestButton.disabled = false
              requestButton.textContent = ${JSON.stringify(appConfig.buttonLabel)}
            }
          })
        </script>
      </body>
    </html>
  `
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
    const accessState = localAppAccessState(appId)
    if (!accessState.granted) {
      html = localAppAccessMarkup(appId, accessState)
      signature = JSON.stringify({ appId, accessState })
    } else {
      const snapshot = loadPromptLibrarySnapshot()
      html = promptsMarkup(snapshot)
      signature = snapshot.signature
    }
  } else if (appId === 'conductor') {
    const accessState = localAppAccessState(appId)
    if (!accessState.granted) {
      html = localAppAccessMarkup(appId, accessState)
      signature = JSON.stringify({ appId, accessState })
    } else {
      const snapshot = loadConductorSnapshot()
      html = conductorMarkup(snapshot)
      signature = snapshot.signature
    }
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
  } else {
    ensureHostedAppLoaded(appId)
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
  if (ensureHostedAppLoaded(appId, target)) {
    return
  }

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
    iconURL: appConfig?.iconPath || '',
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
    if (!localAppAccessState('conductor').granted) {
      return {
        ...defaultAppState(appId),
        title: 'Agents',
      }
    }

    const snapshot = conductorSnapshot || loadConductorSnapshot()

    return {
      ...defaultAppState(appId),
      title: 'Agents',
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
    iconURL: appConfig?.iconPath || '',
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
  const snapshot = conductorSnapshot || maybeLoadConductorSnapshot()

  for (const appConfig of APP_CONFIGS) {
    state[appConfig.id] = appState(appConfig.id, snapshot)
  }

  return state
}

function emitState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  const conductorSnapshot = maybeLoadConductorSnapshot()

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

  const snapshot = conductorSnapshot || maybeLoadConductorSnapshot()
  if (!snapshot) {
    companionWindow.webContents.executeJavaScript(
      `
        (() => {
          const badge = document.querySelector('.companion-badge')
          if (!badge) return
          badge.hidden = true
        })()
      `,
      true
    ).catch(() => {})
    lastCompanionUnreadCount = 0
    return
  }

  const unreadCount = snapshot.unreadAgents.reduce((total, session) => (
    total + Math.max(0, Number(session?.unreadCount || 0))
  ), 0)
  const hasUnread = unreadCount > 0

  if (shouldTriggerUnreadPing(lastCompanionUnreadCount, unreadCount)) {
    triggerCompanionPing()
  }

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

  lastCompanionUnreadCount = unreadCount
}

function triggerCompanionPing() {
  if (!companionWindow || companionWindow.isDestroyed()) {
    return
  }

  if (!canTriggerCompanionPing({
    isCompanionEnabled,
    isCompanionSuppressedForTyping,
    isMainWindowVisible: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()),
  })) {
    return
  }

  companionWindow.webContents.executeJavaScript(
    `
      (() => {
        const companion = document.querySelector('.companion')
        if (!companion) return
        window.__loiterlyCompanionPingTimer && clearTimeout(window.__loiterlyCompanionPingTimer)
        companion.classList.remove('is-pinging')
        void companion.offsetWidth
        companion.classList.add('is-pinging')
        window.__loiterlyCompanionPingTimer = setTimeout(() => {
          companion.classList.remove('is-pinging')
        }, 960)
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
  triggerCompanionPing()
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
  return computeCompanionSuppressed({
    isCompanionEnabled,
    isCompanionSuppressedForTyping,
    isMainWindowVisible: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()),
  })
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
  if (!IS_MAC) {
    show()
    return
  }

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

  return (IS_MAC && cursor.y <= topHotzone) || isFocusWithinWindowGroup()
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

function loadClaudeCliSnapshot() {
  if (!fs.existsSync(CLAUDE_SESSIONS_PATH)) {
    return {
      busyAgents: [],
      waitingAgents: [],
      errors: [],
      signature: JSON.stringify([]),
    }
  }

  const busyAgents = []
  const waitingAgents = []
  const errors = []

  let entries = []
  try {
    entries = fs.readdirSync(CLAUDE_SESSIONS_PATH, { withFileTypes: true })
  } catch (error) {
    return {
      busyAgents,
      waitingAgents,
      errors: [error instanceof Error ? error.message : String(error)],
      signature: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
    }
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue
    }

    const sessionPath = path.join(CLAUDE_SESSIONS_PATH, entry.name)

    try {
      const sessionRecord = JSON.parse(fs.readFileSync(sessionPath, 'utf8'))
      const processInfo = loadClaudeProcessInfo(sessionRecord.pid)
      if (!processInfo) {
        continue
      }

      const transcriptPath = findClaudeTranscriptPath(sessionRecord.sessionId)
      const transcriptSummary = loadClaudeTranscriptSummary(transcriptPath)
      const gitMetadata = resolveGitMetadata(sessionRecord.cwd)
      const status = inferClaudeCliStatus(transcriptSummary)
      const session = normalizeClaudeCliSession({
        sessionRecord,
        processInfo,
        transcriptSummary,
        gitMetadata,
        status,
      })

      if (status === 'busy') {
        busyAgents.push(session)
      } else {
        waitingAgents.push(session)
      }
    } catch (error) {
      errors.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const sortNewestFirst = (left, right) => {
    return sortTimestampDescending(left.updatedAtRaw, right.updatedAtRaw)
  }

  busyAgents.sort(sortNewestFirst)
  waitingAgents.sort(sortNewestFirst)

  return {
    busyAgents,
    waitingAgents,
    errors,
    signature: JSON.stringify([...busyAgents, ...waitingAgents]),
  }
}

function loadClaudeProcessInfo(pid) {
  const parsedPid = Number.parseInt(`${pid || ''}`, 10)
  if (!Number.isInteger(parsedPid) || parsedPid < 1) {
    return null
  }

  try {
    const raw = execFileSync(
      'ps',
      ['-p', `${parsedPid}`, '-o', 'pid=,tty=,stat=,etime=,command='],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    ).trim()

    if (!raw) {
      return null
    }

    const match = raw.match(/^(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+([\s\S]+)$/)
    if (!match) {
      return null
    }

    const [, resolvedPid, tty, stat, elapsed, command] = match
    const normalizedCommand = `${command || ''}`.trim()
    if (!/\bclaude\b/i.test(normalizedCommand)) {
      return null
    }

    return {
      pid: Number.parseInt(resolvedPid, 10),
      tty,
      stat,
      elapsed,
      command: normalizedCommand,
    }
  } catch {
    return null
  }
}

function findClaudeTranscriptPath(sessionId) {
  const normalizedSessionId = `${sessionId || ''}`.trim()
  if (!normalizedSessionId) {
    return ''
  }

  const cachedPath = claudeTranscriptPathCache.get(normalizedSessionId)
  if (cachedPath && fs.existsSync(cachedPath)) {
    return cachedPath
  }

  const directPath = path.join(CLAUDE_PROJECTS_PATH, `${normalizedSessionId}.jsonl`)
  if (fs.existsSync(directPath)) {
    claudeTranscriptPathCache.set(normalizedSessionId, directPath)
    return directPath
  }

  if (!fs.existsSync(CLAUDE_PROJECTS_PATH)) {
    return ''
  }

  try {
    const rootEntries = fs.readdirSync(CLAUDE_PROJECTS_PATH, { withFileTypes: true })
    for (const entry of rootEntries) {
      if (!entry.isDirectory()) {
        continue
      }

      const candidatePath = path.join(CLAUDE_PROJECTS_PATH, entry.name, `${normalizedSessionId}.jsonl`)
      if (fs.existsSync(candidatePath)) {
        claudeTranscriptPathCache.set(normalizedSessionId, candidatePath)
        return candidatePath
      }
    }
  } catch {
    return ''
  }

  return ''
}

function loadClaudeTranscriptSummary(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    return null
  }

  const tail = readUtf8Tail(transcriptPath, CLAUDE_TRANSCRIPT_TAIL_BYTES)
  if (!tail) {
    return null
  }

  const lines = tail.split('\n')
  if (tail.length >= CLAUDE_TRANSCRIPT_TAIL_BYTES && lines.length > 0) {
    lines.shift()
  }

  let lastActivityAt = ''
  let lastMeaningfulEvent = null
  let lastPromptSummary = ''
  let model = ''

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim()
    if (!line) {
      continue
    }

    let event = null
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }

    if (!lastActivityAt && typeof event.timestamp === 'string') {
      lastActivityAt = event.timestamp
    }

    if (!model && typeof event.message?.model === 'string') {
      model = event.message.model
    }

    if (!lastPromptSummary) {
      const promptSummary = extractClaudePromptSummary(event)
      if (promptSummary) {
        lastPromptSummary = promptSummary
      }
    }

    if (!lastMeaningfulEvent) {
      lastMeaningfulEvent = classifyClaudeMeaningfulEvent(event)
    }

    if (lastActivityAt && lastMeaningfulEvent && lastPromptSummary && model) {
      break
    }
  }

  return {
    lastActivityAt,
    lastMeaningfulEvent,
    lastPromptSummary,
    model,
  }
}

function readUtf8Tail(filePath, maxBytes) {
  const stats = fs.statSync(filePath)
  if (stats.size < 1) {
    return ''
  }

  const byteCount = Math.min(stats.size, maxBytes)
  const buffer = Buffer.alloc(byteCount)
  const fileDescriptor = fs.openSync(filePath, 'r')

  try {
    fs.readSync(fileDescriptor, buffer, 0, byteCount, stats.size - byteCount)
    return buffer.toString('utf8')
  } finally {
    fs.closeSync(fileDescriptor)
  }
}

function classifyClaudeMeaningfulEvent(event) {
  if (!event || typeof event !== 'object') {
    return null
  }

  if (event.type === 'assistant' && event.message?.role === 'assistant') {
    return {
      type: 'assistant',
      stopReason: event.message?.stop_reason || '',
    }
  }

  if (event.type === 'user' && event.message?.role === 'user') {
    return {
      type: 'user',
      hasToolResult: hasClaudeToolResult(event.message?.content),
    }
  }

  return null
}

function hasClaudeToolResult(content) {
  if (!Array.isArray(content)) {
    return false
  }

  return content.some((item) => item && typeof item === 'object' && item.type === 'tool_result')
}

function extractClaudePromptSummary(event) {
  if (!event || typeof event !== 'object') {
    return ''
  }

  if (event.type === 'last-prompt' && typeof event.lastPrompt === 'string') {
    return summarizeClaudePrompt(event.lastPrompt)
  }

  if (event.type !== 'user' || event.message?.role !== 'user') {
    return ''
  }

  const content = event.message?.content
  if (Array.isArray(content) && content.some((item) => item && item.type === 'tool_result')) {
    return ''
  }

  return summarizeClaudePrompt(extractClaudeTextContent(content))
}

function extractClaudeTextContent(content) {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .filter((item) => item && typeof item === 'object' && item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join(' ')
}

function summarizeClaudePrompt(value) {
  const normalized = `${value || ''}`.replace(/\s+/g, ' ').trim()
  if (!normalized || normalized.startsWith('<') || normalized.startsWith('/')) {
    return ''
  }

  if (normalized.length <= 72) {
    return normalized
  }

  return `${normalized.slice(0, 69)}...`
}

function inferClaudeCliStatus(transcriptSummary) {
  const lastEvent = transcriptSummary?.lastMeaningfulEvent
  if (!lastEvent) {
    return 'waiting'
  }

  if (lastEvent.type === 'assistant' && lastEvent.stopReason === 'end_turn') {
    return 'waiting'
  }

  return 'busy'
}

function normalizeClaudeCliSession({ sessionRecord, processInfo, transcriptSummary, gitMetadata, status }) {
  const sessionId = `${sessionRecord.sessionId || ''}`.trim()
  const promptSummary = transcriptSummary?.lastPromptSummary || ''
  const updatedAtRaw = transcriptSummary?.lastActivityAt || ''
  const startedAtRaw = sessionRecord.startedAt || ''
  const cwd = `${sessionRecord.cwd || ''}`.trim()
  const fallbackTitle = cwd ? path.basename(cwd) : `Claude CLI ${sessionId.slice(0, 8)}`

  return {
    source: 'Terminal Claude',
    repo: gitMetadata.repo || 'Terminal Claude',
    title: promptSummary || fallbackTitle,
    workspace: cwd || 'Unknown working directory',
    cwd,
    branch: gitMetadata.branch || 'No branch detected',
    agentType: 'claude-cli',
    model: transcriptSummary?.model || 'unknown',
    updatedAt: formatDisplayTimestamp(updatedAtRaw) || 'Unknown',
    updatedAtRaw,
    startedAt: formatDisplayTimestamp(startedAtRaw) || 'Unknown',
    pid: processInfo.pid,
    unreadCount: 0,
    sessionId,
    workspaceId: '',
    tty: processInfo.tty,
    status,
    transcriptEntries: loadClaudeCliTranscriptEntries(findClaudeTranscriptPath(sessionId)),
  }
}

function resolveGitMetadata(cwd) {
  const normalizedCwd = `${cwd || ''}`.trim()
  if (!normalizedCwd) {
    return { repo: '', branch: '' }
  }

  const cached = gitMetadataCache.get(normalizedCwd)
  if (cached && Date.now() - cached.cachedAt < GIT_METADATA_CACHE_TTL_MS) {
    return cached.value
  }

  let value = {
    repo: path.basename(normalizedCwd) || '',
    branch: '',
  }

  try {
    const repoRoot = execFileSync('git', ['-C', normalizedCwd, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    const branch = execFileSync('git', ['-C', normalizedCwd, 'branch', '--show-current'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()

    value = {
      repo: path.basename(repoRoot) || value.repo,
      branch: branch || 'Detached HEAD',
    }
  } catch {
    value = {
      repo: value.repo,
      branch: '',
    }
  }

  gitMetadataCache.set(normalizedCwd, {
    cachedAt: Date.now(),
    value,
  })

  return value
}

function formatDisplayTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'medium',
    })
  }

  const normalizedValue = `${value || ''}`.trim()
  if (!normalizedValue) {
    return ''
  }

  const date = new Date(normalizedValue)
  if (Number.isNaN(date.getTime())) {
    return normalizedValue
  }

  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  })
}

function sortTimestampDescending(left, right) {
  const leftTimestamp = Date.parse(`${left || ''}`) || 0
  const rightTimestamp = Date.parse(`${right || ''}`) || 0
  return rightTimestamp - leftTimestamp
}

function loadClaudeCliTranscriptEntries(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    return []
  }

  try {
    const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n')
    const entries = []

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line) {
        continue
      }

      let event = null
      try {
        event = JSON.parse(line)
      } catch {
        continue
      }

      const entry = normalizeClaudeTranscriptEvent(event)
      if (entry) {
        entries.push(entry)
      }
    }

    return entries.slice(-MAX_TRANSCRIPT_MESSAGES)
  } catch {
    return []
  }
}

function normalizeClaudeTranscriptEvent(event) {
  if (!event || typeof event !== 'object') {
    return null
  }

  if (event.type === 'assistant' && event.message?.role === 'assistant') {
    const text = extractTranscriptText(event.message?.content)
    if (!text) {
      return null
    }

    return {
      role: 'assistant',
      text,
      timestamp: event.timestamp || '',
    }
  }

  if (event.type === 'user' && event.message?.role === 'user') {
    if (hasClaudeToolResult(event.message?.content)) {
      return null
    }

    const text = extractTranscriptText(event.message?.content)
    if (!text) {
      return null
    }

    return {
      role: 'user',
      text,
      timestamp: event.timestamp || '',
    }
  }

  return null
}

function loadConductorTranscriptEntries(sessionId) {
  const normalizedSessionId = `${sessionId || ''}`.trim()
  if (!normalizedSessionId) {
    return []
  }

  const escapedSessionId = normalizedSessionId.replaceAll("'", "''")
  const sql = `
    SELECT COALESCE(
      json_group_array(
        json_object(
          'role', role,
          'content', content,
          'createdAt', created_at
        )
      ),
      '[]'
    ) AS payload
    FROM (
      SELECT role, content, created_at
      FROM session_messages
      WHERE session_id = '${escapedSessionId}'
      ORDER BY datetime(created_at) DESC
      LIMIT ${MAX_TRANSCRIPT_MESSAGES * 3}
    );
  `

  try {
    const raw = readJsonPayloadFromDatabase(CONDUCTOR_DB_PATH, sql)
    const rows = raw ? JSON.parse(raw) : []
    const normalizedRows = Array.isArray(rows) ? rows.reverse() : []
    const entries = normalizedRows
      .map((row) => normalizeConductorTranscriptRow(row))
      .filter(Boolean)

    return entries.slice(-MAX_TRANSCRIPT_MESSAGES)
  } catch {
    return []
  }
}

function normalizeConductorTranscriptRow(row) {
  if (!row || typeof row !== 'object') {
    return null
  }

  const parsedContent = parseJsonSafely(row.content)
  if (parsedContent?.message?.role) {
    if (hasClaudeToolResult(parsedContent.message.content)) {
      return null
    }

    const text = extractTranscriptText(parsedContent.message.content)
    if (!text) {
      return null
    }

    return {
      role: parsedContent.message.role,
      text,
      timestamp: parsedContent.timestamp || row.createdAt || '',
    }
  }

  const role = `${row.role || ''}`.trim()
  const text = `${row.content || ''}`.trim()
  if (!text || !['user', 'assistant'].includes(role)) {
    return null
  }

  return {
    role,
    text,
    timestamp: row.createdAt || '',
  }
}

function parseJsonSafely(value) {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  if (!normalized.startsWith('{') && !normalized.startsWith('[')) {
    return null
  }

  try {
    return JSON.parse(normalized)
  } catch {
    return null
  }
}

function extractTranscriptText(content) {
  if (typeof content === 'string') {
    return content.trim()
  }

  if (!Array.isArray(content)) {
    return ''
  }

  const parts = content
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return ''
      }

      if (item.type === 'text' && typeof item.text === 'string') {
        return item.text
      }

      if (typeof item.content === 'string' && item.type !== 'tool_result' && item.type !== 'tool_use') {
        return item.content
      }

      return ''
    })
    .filter(Boolean)

  return parts.join('\n\n').trim()
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
    ) AS payload
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

  const claudeCliSnapshot = loadClaudeCliSnapshot()

  try {
    const raw = readJsonPayloadFromDatabase(CONDUCTOR_DB_PATH, sql)
    const sessions = raw ? JSON.parse(raw) : []
    const normalizedSessions = Array.isArray(sessions) ? sessions : []
    const sessionsWithTranscripts = normalizedSessions.map((session) => ({
      ...session,
      transcriptEntries: loadConductorTranscriptEntries(session.sessionId),
    }))

    return {
      activeAgents: sessionsWithTranscripts.filter((session) => session.status === 'working'),
      idleAgents: sessionsWithTranscripts.filter((session) => session.status === 'idle'),
      terminalBusyAgents: claudeCliSnapshot.busyAgents,
      terminalWaitingAgents: claudeCliSnapshot.waitingAgents,
      unreadAgents: sessionsWithTranscripts.filter((session) => Number(session.unreadCount || 0) > 0),
      dbPath: CONDUCTOR_DB_PATH,
      claudeSessionsPath: CLAUDE_SESSIONS_PATH,
      refreshedAt: new Date().toISOString(),
      errors: claudeCliSnapshot.errors,
      signature: JSON.stringify({
        conductor: sessionsWithTranscripts,
        claudeCli: [...claudeCliSnapshot.busyAgents, ...claudeCliSnapshot.waitingAgents],
      }),
    }
  } catch (error) {
    const conductorError = error instanceof Error ? error.message : String(error)
    return {
      activeAgents: [],
      idleAgents: [],
      terminalBusyAgents: claudeCliSnapshot.busyAgents,
      terminalWaitingAgents: claudeCliSnapshot.waitingAgents,
      unreadAgents: [],
      dbPath: CONDUCTOR_DB_PATH,
      claudeSessionsPath: CLAUDE_SESSIONS_PATH,
      refreshedAt: new Date().toISOString(),
      errors: [conductorError, ...claudeCliSnapshot.errors],
      signature: JSON.stringify({
        error: conductorError,
        claudeCli: [...claudeCliSnapshot.busyAgents, ...claudeCliSnapshot.waitingAgents],
      }),
    }
  }
}

function conductorMarkup({
  activeAgents,
  idleAgents,
  terminalBusyAgents,
  terminalWaitingAgents,
  unreadAgents,
  dbPath,
  claudeSessionsPath,
  refreshedAt,
  errors = [],
}) {
  const refreshedLabel = escapeHtml(
    new Date(refreshedAt).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'medium',
    })
  )

  const combinedSessions = buildCombinedSessionRows({
    activeAgents,
    idleAgents,
    terminalBusyAgents,
    terminalWaitingAgents,
  })

  const errorBanner = errors.length
    ? `
      <div class="error-banner">
        ${errors.map((message) => `<div>${escapeHtml(message)}</div>`).join('')}
      </div>
    `
    : ''

  const sessionRecords = combinedSessions.map((session) => ({
    key: session.modalKey,
    title: session.title,
    source: session.source,
    statusLabel: session.statusLabel,
    repo: session.repo,
    workspace: session.workspace,
    branch: session.branch,
    updatedAt: session.updatedAt,
    transcriptEntries: session.transcriptEntries || [],
  }))

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Agents</title>
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
            overflow: hidden;
            border-radius: 22px;
            background: linear-gradient(180deg, var(--panel-strong), var(--panel));
            border: 1px solid var(--border);
            box-shadow:
              0 16px 36px rgba(103, 120, 146, 0.08),
              inset 0 1px 0 rgba(255,255,255,0.84);
          }
          .table-shell {
            overflow-x: auto;
          }
          table {
            width: 100%;
            border-collapse: collapse;
          }
          thead th {
            text-align: left;
            padding: 12px 16px;
            font-size: 11px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: var(--muted);
            background: rgba(255, 255, 255, 0.55);
            border-bottom: 1px solid var(--border);
          }
          tbody td {
            padding: 12px 16px;
            vertical-align: top;
            border-bottom: 1px solid rgba(147, 163, 184, 0.16);
          }
          tbody tr:last-child td {
            border-bottom: 0;
          }
          tbody tr:hover td {
            background: rgba(255, 255, 255, 0.34);
          }
          tbody tr[data-session-key] {
            cursor: pointer;
          }
          .table-title {
            font-weight: 600;
            letter-spacing: -0.01em;
          }
          .table-meta {
            margin-top: 4px;
            color: var(--muted);
            font-size: 12px;
            line-height: 1.4;
          }
          .table-repo {
            color: var(--accent);
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.06em;
            text-transform: uppercase;
          }
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
          .status-pill--unread {
            background: var(--accent-soft);
            color: var(--accent);
          }
          .status-pill--idle {
            background: rgba(97, 112, 134, 0.14);
            color: var(--muted);
          }
          .source-badge {
            display: inline-flex;
            align-items: center;
            padding: 6px 10px;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.72);
            border: 1px solid rgba(147, 163, 184, 0.24);
            font-size: 12px;
            font-weight: 600;
          }
          .empty-state p {
            margin: 8px 0 0;
            color: var(--muted);
          }
          .modal {
            position: fixed;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            background: rgba(17, 24, 39, 0.32);
            backdrop-filter: blur(10px);
          }
          .modal[hidden] {
            display: none;
          }
          .modal__panel {
            width: min(900px, 100%);
            max-height: min(80vh, 900px);
            overflow: hidden;
            border-radius: 24px;
            background: linear-gradient(180deg, rgba(255,255,255,0.96), rgba(247,250,252,0.94));
            border: 1px solid rgba(147, 163, 184, 0.24);
            box-shadow: 0 24px 60px rgba(15, 23, 42, 0.18);
          }
          .modal__header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 16px;
            padding: 20px 22px 16px;
            border-bottom: 1px solid rgba(147, 163, 184, 0.18);
          }
          .modal__title {
            margin: 0;
            font-size: 24px;
            letter-spacing: -0.03em;
          }
          .modal__meta {
            margin-top: 6px;
            color: var(--muted);
            font-size: 13px;
            line-height: 1.5;
          }
          .modal__close {
            border: 0;
            background: rgba(23, 32, 48, 0.06);
            color: var(--text);
            border-radius: 999px;
            width: 36px;
            height: 36px;
            font-size: 18px;
            cursor: pointer;
          }
          .transcript {
            padding: 18px 22px 22px;
            max-height: calc(min(80vh, 900px) - 96px);
            overflow-y: auto;
            display: grid;
            gap: 14px;
          }
          .message {
            padding: 14px 16px;
            border-radius: 18px;
            background: rgba(255, 255, 255, 0.74);
            border: 1px solid rgba(147, 163, 184, 0.16);
          }
          .message--user {
            background: rgba(46, 104, 219, 0.08);
            border-color: rgba(46, 104, 219, 0.12);
          }
          .message__meta {
            margin-bottom: 8px;
            color: var(--muted);
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }
          .message__body {
            white-space: pre-wrap;
            line-height: 1.55;
          }
          .transcript-empty {
            padding: 18px;
            border-radius: 18px;
            background: rgba(255,255,255,0.66);
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
            <h1>Agents</h1>
            <p class="subtitle">
              This view reads Conductor's local SQLite state and Claude CLI session logs in one compact session table.
            </p>
          </div>
          <div class="meta">
            Last refreshed<br />
            <strong>${refreshedLabel}</strong>
            <code>${escapeHtml(dbPath)}</code>
            <code>${escapeHtml(claudeSessionsPath)}</code>
          </div>
        </header>
        <div class="summary">
          ${combinedSessions.filter((session) => session.statusOrder === 0).length} unread ·
          ${combinedSessions.filter((session) => session.statusOrder === 1).length} need input ·
          ${combinedSessions.filter((session) => session.statusOrder === 2).length} running ·
          ${combinedSessions.filter((session) => session.statusOrder === 3).length} idle ·
          ${unreadAgents.length} unread
        </div>
        ${errorBanner}
        ${sessionsTableMarkup(combinedSessions)}
        <div id="session-modal" class="modal" hidden>
          <div class="modal__panel">
            <div class="modal__header">
              <div>
                <h2 id="session-modal-title" class="modal__title">Session</h2>
                <div id="session-modal-meta" class="modal__meta"></div>
              </div>
              <button id="session-modal-close" class="modal__close" type="button" aria-label="Close">×</button>
            </div>
            <div id="session-transcript" class="transcript"></div>
          </div>
        </div>
        <script>
          const sessionRecords = ${serializeForInlineScript(sessionRecords)}
          const sessionRecordMap = new Map(sessionRecords.map((session) => [session.key, session]))
          const sessionModal = document.getElementById('session-modal')
          const sessionModalTitle = document.getElementById('session-modal-title')
          const sessionModalMeta = document.getElementById('session-modal-meta')
          const sessionTranscript = document.getElementById('session-transcript')
          const sessionModalClose = document.getElementById('session-modal-close')

          function escapeMarkup(value) {
            return \`\${value ?? ''}\`
              .replaceAll('&', '&amp;')
              .replaceAll('<', '&lt;')
              .replaceAll('>', '&gt;')
              .replaceAll('"', '&quot;')
              .replaceAll(\"'\", '&#39;')
          }

          function renderTranscript(entries) {
            if (!entries.length) {
              sessionTranscript.innerHTML = '<div class="transcript-empty">No conversation history is available for this session.</div>'
              return
            }

            sessionTranscript.innerHTML = entries.map((entry) => {
              const role = entry.role === 'user' ? 'User' : 'Assistant'
              const className = entry.role === 'user' ? 'message message--user' : 'message'
              return \`
                <article class="\${className}">
                  <div class="message__meta">\${escapeMarkup(role)} · \${escapeMarkup(entry.timestamp || 'Unknown')}</div>
                  <div class="message__body">\${escapeMarkup(entry.text || '')}</div>
                </article>
              \`
            }).join('')
          }

          function scrollTranscriptToBottom() {
            requestAnimationFrame(() => {
              sessionTranscript.scrollTop = sessionTranscript.scrollHeight
            })
          }

          function openSessionModal(sessionKey) {
            const session = sessionRecordMap.get(sessionKey)
            if (!session) {
              return
            }

            sessionModalTitle.textContent = session.title || 'Session'
            sessionModalMeta.textContent = [session.source, session.statusLabel, session.repo, session.branch, session.updatedAt]
              .filter(Boolean)
              .join(' · ')
            renderTranscript(session.transcriptEntries || [])
            sessionModal.hidden = false
            scrollTranscriptToBottom()
          }

          function closeSessionModal() {
            sessionModal.hidden = true
          }

          document.querySelectorAll('tr[data-session-key]').forEach((row) => {
            row.addEventListener('click', () => openSessionModal(row.dataset.sessionKey))
          })

          sessionModalClose.addEventListener('click', closeSessionModal)
          sessionModal.addEventListener('click', (event) => {
            if (event.target === sessionModal) {
              closeSessionModal()
            }
          })
          document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !sessionModal.hidden) {
              closeSessionModal()
            }
          })
        </script>
      </body>
    </html>
  `
}

function buildCombinedSessionRows({
  activeAgents,
  idleAgents,
  terminalBusyAgents,
  terminalWaitingAgents,
}) {
  const rows = []

  const pushRows = (sessions, source, statusKey) => {
    for (const session of sessions) {
      const resolvedStatusKey = Number(session.unreadCount || 0) > 0 ? 'unread' : statusKey
      rows.push(normalizeCombinedSessionRow(session, source, resolvedStatusKey))
    }
  }

  pushRows(idleAgents, 'Conductor', 'needs_input')
  pushRows(terminalWaitingAgents, 'Terminal', 'needs_input')
  pushRows(activeAgents, 'Conductor', 'running')
  pushRows(terminalBusyAgents, 'Terminal', 'running')

  rows.sort((left, right) => {
    if (left.statusOrder !== right.statusOrder) {
      return left.statusOrder - right.statusOrder
    }

    return sortTimestampDescending(left.updatedAtRaw, right.updatedAtRaw)
  })

  return rows
}

function normalizeCombinedSessionRow(session, source, statusKey) {
  const statusMeta = combinedStatusMeta(statusKey)
  return {
    ...session,
    modalKey: `${source.toLowerCase()}:${session.sessionId || session.workspaceId || session.title || 'session'}`,
    source,
    statusLabel: statusMeta.label,
    statusClassName: statusMeta.className,
    statusOrder: statusMeta.order,
  }
}

function combinedStatusMeta(statusKey) {
  if (statusKey === 'unread') {
    return {
      label: 'Unread',
      className: 'status-pill status-pill--unread',
      order: 0,
    }
  }

  if (statusKey === 'needs_input') {
    return {
      label: 'Needs Input',
      className: 'status-pill status-pill--alert',
      order: 1,
    }
  }

  if (statusKey === 'running') {
    return {
      label: 'Running',
      className: 'status-pill',
      order: 2,
    }
  }

  return {
    label: 'Idle',
    className: 'status-pill status-pill--idle',
    order: 3,
  }
}

function sessionsTableMarkup(sessions) {
  if (!sessions.length) {
    return `
      <div class="empty-state agent-list">
        <h2>No sessions</h2>
        <p>No Conductor or terminal Claude sessions are currently visible.</p>
      </div>
    `
  }

  const rows = sessions.map((session) => {
    const title = escapeHtml(session.title || 'Untitled session')
    const repo = escapeHtml(session.repo || 'Unknown repo')
    const workspace = escapeHtml(session.workspace || session.cwd || 'Unknown workspace')
    const branch = escapeHtml(session.branch || 'No branch')
    const updatedAt = escapeHtml(session.updatedAt || 'Unknown')
    const metaParts = [
      session.model ? escapeHtml(session.model) : '',
      session.pid ? `PID ${escapeHtml(session.pid)}` : '',
      session.sessionId ? escapeHtml(session.sessionId.slice(0, 8)) : '',
    ].filter(Boolean)

    return `
      <tr data-session-key="${escapeHtml(session.modalKey)}">
        <td><span class="${session.statusClassName}">${escapeHtml(session.statusLabel)}</span></td>
        <td><span class="source-badge">${escapeHtml(session.source)}</span></td>
        <td>
          <div class="table-title">${title}</div>
          <div class="table-meta">${metaParts.join(' · ')}</div>
        </td>
        <td><div class="table-repo">${repo}</div></td>
        <td>${workspace}</td>
        <td>${branch}</td>
        <td>${updatedAt}</td>
      </tr>
    `
  }).join('')

  return `
    <section class="agent-list">
      <div class="table-shell">
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Source</th>
              <th>Session</th>
              <th>Repo</th>
              <th>Workspace</th>
              <th>Branch</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
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

ipcMain.handle('shell:get-state', async () => ({
  activeApp,
  apps: allAppStates(maybeLoadConductorSnapshot()),
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

ipcMain.handle('local-app:request-access', async (_event, appId) => {
  if (!appId || typeof appId !== 'string') {
    return {
      granted: false,
      requested: false,
      lastError: 'Invalid local app access request.',
    }
  }

  const appConfig = apps.get(appId)
  if (!appConfig || appConfig.type !== 'local') {
    return localAppAccessState(appId)
  }

  const nextState = requestLocalAppAccess(appId)
  localAppSignatures.delete(appId)
  refreshLocalAppView(appId)
  emitState()
  return nextState
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
  stopCompanionInputMonitor()
  console.info('app before-quit')
})

app.on('render-process-gone', (_event, contents, details) => {
  console.error('render-process-gone', {
    reason: details?.reason,
    exitCode: details?.exitCode,
    url: contents?.getURL?.() || '',
  })
})

app.on('child-process-gone', (_event, details) => {
  console.error('child-process-gone', details)
})

app.whenReady().then(() => {
  console.info('app ready', { logPath: MAIN_LOG_PATH })
  if (IS_WINDOWS) {
    app.setAppUserModelId('com.arthurdevel.loiterly')
  }
  if (app.dock) {
    app.dock.hide()
  }

  initializeLaunchAtLoginPreference()

  mainWindow = createShellWindow()
  backdropWindow = createBackdropWindow()
  companionWindow = createCompanionWindow()
  startCompanionInputMonitor()
  createViews()
  createTray()
  configureAutoUpdater()
  registerShortcuts()
  startConductorRefresh()
  startReleaseChecks()
  void refreshGitHubIssuesRepos()
  setActiveApp(activeApp)

  if (shouldStartHiddenAtLaunch()) {
    hideWindow()
  } else {
    showWindow()
    showCompanion()
  }
})

app.on('will-quit', () => {
  console.info('app will-quit')
  stopCompanionInputMonitor()
  globalShortcut.unregisterAll()
  closeMainLog()
})

app.on('window-all-closed', (event) => {
  event.preventDefault()
})
