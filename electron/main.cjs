const path = require('node:path')
const {
  app,
  BrowserWindow,
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
const COMPANION_SIZE = 20
const COMPANION_OFFSET = { x: 10, y: -14 }
const ACTIVE_SPACE_HOP_DELAY_MS = 140
const SHARED_REMOTE_PARTITION = 'persist:loiterly-browser'
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
    id: 'links',
    label: 'Links',
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
let companionPosition = null
let lastCursorPoint = null

const views = new Map()
const visibleViews = new Set()
const apps = new Map(APP_CONFIGS.map((appConfig) => [appConfig.id, appConfig]))
const popupWindows = new Set()
const configuredPermissionPartitions = new Set()

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
  tray.on('click', toggleWindowVisibility)
  refreshTrayMenu()
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
    {
      label: 'Open Browser',
      click: () => {
        setActiveApp('browser')
        showWindow()
      },
    },
    {
      label: 'Open Notion',
      click: () => {
        setActiveApp('notion')
        showWindow()
      },
    },
    {
      label: 'Open GitHub',
      click: () => {
        setActiveApp('github')
        showWindow()
      },
    },
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

    emitState()
  })
  contents.on('did-start-loading', emitState)
  contents.on('did-stop-loading', emitState)
  contents.on('did-navigate', emitState)
  contents.on('did-navigate-in-page', emitState)
  contents.on('page-title-updated', emitState)
  contents.on('page-favicon-updated', emitState)

  contents.loadURL(appConfig.initialURL)
  return view
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
    overrideBrowserWindowOptions: {
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
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        autoplayPolicy: 'user-gesture-required',
      },
    },
    outlivesOpener: false,
    createWindow: (options) => {
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
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  attachCompanionInputTracking(view.webContents)
  const html = appConfig.id === 'links' ? linksMarkup() : ''
  view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  view.webContents.on('page-title-updated', emitState)
  view.webContents.on('did-finish-load', emitState)
  view.webContents.executeJavaScript(`document.title = ${JSON.stringify(appConfig.label)}`)
  return view
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
    targetView.setBackgroundColor('#00000000')
  } catch {
  }
}

function setActiveApp(appId) {
  if (!apps.has(appId) || !views.has(appId)) {
    return
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
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
    showAddressBar: appConfig ? appConfig.showAddressBar : false,
    showNavigation: appConfig ? appConfig.showNavigation : false,
  }
}

function appState(appId) {
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
    canGoBack: isRemoteApp && navigationHistory ? navigationHistory.canGoBack() : false,
    canGoForward: isRemoteApp && navigationHistory ? navigationHistory.canGoForward() : false,
    isLoading: contents.isLoading(),
    showAddressBar: appConfig ? appConfig.showAddressBar : false,
    showNavigation: appConfig ? appConfig.showNavigation : false,
  }
}

function allAppStates() {
  const state = {}

  for (const appConfig of APP_CONFIGS) {
    state[appConfig.id] = appState(appConfig.id)
  }

  return state
}

function emitState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  mainWindow.webContents.send('shell:state', {
    activeApp,
    apps: allAppStates(),
    globalShortcut: GLOBAL_TOGGLE_SHORTCUT,
  })

  refreshTrayMenu()
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
          <a href="https://www.figma.com">
            Figma
            <p>Example of a heavier web app that should live inside the frame.</p>
          </a>
        </div>
      </body>
    </html>
  `
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
  globalShortcut: GLOBAL_TOGGLE_SHORTCUT,
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
  registerShortcuts()
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
