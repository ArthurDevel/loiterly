const path = require('node:path')
const {
  app,
  BrowserWindow,
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
const GLOBAL_TOGGLE_SHORTCUT = 'CommandOrControl+Shift+L'
const BROWSER_PARTITION = 'persist:loiterly-browser'
const COMPANION_SIZE = 20
const COMPANION_OFFSET = { x: 10, y: -14 }
const ACTIVE_SPACE_HOP_DELAY_MS = 140

let tray = null
let mainWindow = null
let companionWindow = null
let backdropWindow = null
let isQuitting = false
let activeApp = 'browser'
let contentBounds = { x: 120, y: 84, width: 980, height: 640 }
let isCompanionEnabled = true
let companionInterval = null
let companionPosition = null

const views = new Map()
const visibleViews = new Set()

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

  window.on('closed', () => {
    mainWindow = null
  })

  return window
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
  views.set('browser', createBrowserView())
  views.set('notes', createLocalAppView('Notes', notesMarkup()))
  views.set('links', createLocalAppView('Links', linksMarkup()))
}

function createBrowserView() {
  const view = new WebContentsView({
    webPreferences: {
      partition: BROWSER_PARTITION,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      autoplayPolicy: 'user-gesture-required',
    },
  })

  const contents = view.webContents
  const browserSession = contents.session

  browserSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false)
  })

  contents.setWindowOpenHandler(({ url }) => {
    navigateBrowser(url)
    return { action: 'deny' }
  })

  contents.on('will-navigate', (_event, url) => {
    updateBrowserState({ url })
  })

  contents.on('did-start-loading', emitState)
  contents.on('did-stop-loading', emitState)
  contents.on('did-navigate', emitState)
  contents.on('did-navigate-in-page', emitState)
  contents.on('page-title-updated', emitState)
  contents.on('page-favicon-updated', emitState)

  contents.loadURL('https://www.google.com')
  return view
}

function createLocalAppView(title, html) {
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  view.webContents.on('page-title-updated', emitState)
  view.webContents.on('did-finish-load', emitState)
  view.webContents.executeJavaScript(`document.title = ${JSON.stringify(title)}`)
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
  if (!views.has(appId)) {
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

function updateBrowserState(partial = {}) {
  emitState(partial)
}

function browserState() {
  const browserView = views.get('browser')
  if (!browserView) {
    return {
      url: '',
      title: 'Loiterly Browser',
      canGoBack: false,
      canGoForward: false,
      isLoading: false,
    }
  }

  const contents = browserView.webContents
  return {
    url: contents.getURL() || '',
    title: contents.getTitle() || 'Loiterly Browser',
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
    isLoading: contents.isLoading(),
  }
}

function emitState(overrides = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  mainWindow.webContents.send('shell:state', {
    activeApp,
    browser: {
      ...browserState(),
      ...overrides,
    },
    globalShortcut: GLOBAL_TOGGLE_SHORTCUT,
  })

  refreshTrayMenu()
}

function clampWindowOrigin(point) {
  const display = screen.getDisplayNearestPoint(point)
  const area = display.workArea

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

function showWindow() {
  if (!mainWindow || !backdropWindow) {
    return
  }

  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const workArea = display.workArea
  const origin = clampWindowOrigin({
    x: cursor.x + 24,
    y: cursor.y - WINDOW_HEIGHT + 32,
  })

  backdropWindow.setBounds({
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
  })
  showOnActiveSpace(backdropWindow, () => {
    backdropWindow.showInactive()
  })

  mainWindow.setBounds({
    x: origin.x,
    y: origin.y,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
  })
  showOnActiveSpace(mainWindow, () => {
    mainWindow.show()
    app.focus({ steal: true })
    mainWindow.focus()
  })
  ensureVisibleView(activeApp)
  emitState()
}

function hideWindow() {
  if (!mainWindow || !backdropWindow) {
    return
  }

  mainWindow.hide()
  backdropWindow.hide()
  refreshTrayMenu()
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

  return cursor.y <= topHotzone
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
  updateCompanionPosition()
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

function notesMarkup() {
  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Notes</title>
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
          .card {
            border: 1px solid rgba(173,184,201,0.24);
            border-radius: 22px;
            padding: 22px;
            background: rgba(255,255,255,0.72);
            box-shadow:
              0 18px 40px rgba(103,120,146,0.12),
              inset 0 1px 0 rgba(255,255,255,0.92);
            line-height: 1.5;
            max-width: 720px;
            color: #445163;
          }
        </style>
      </head>
      <body>
        <h1>Notes</h1>
        <div class="card">
          This tile is a persistent Chromium view. It stays alive when the frame hides, which is the main behavior we want for future apps.
        </div>
      </body>
    </html>
  `
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
  browser: browserState(),
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
  showCompanion()
  showWindow()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', (event) => {
  event.preventDefault()
})
