const shell = window.loiterlyShell

const state = {
  activeApp: 'browser',
  browser: {
    url: '',
    title: 'Loiterly Browser',
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
  },
  globalShortcut: 'CommandOrControl+Shift+Space',
}

const elements = {
  tiles: Array.from(document.querySelectorAll('.tile')),
  contentHost: document.getElementById('content-host'),
  addressForm: document.getElementById('address-form'),
  addressInput: document.getElementById('address-input'),
  pageTitle: document.getElementById('page-title'),
  pageStatus: document.getElementById('page-status'),
  goBack: document.getElementById('go-back'),
  goForward: document.getElementById('go-forward'),
  reload: document.getElementById('reload'),
  hideWindow: document.getElementById('hide-window'),
  globalShortcut: document.getElementById('global-shortcut'),
}

function render() {
  elements.tiles.forEach((tile) => {
    tile.classList.toggle('is-active', tile.dataset.app === state.activeApp)
  })

  if (state.activeApp === 'browser') {
    elements.addressInput.removeAttribute('disabled')
    elements.goBack.disabled = !state.browser.canGoBack
    elements.goForward.disabled = !state.browser.canGoForward
    elements.reload.disabled = false
    elements.addressInput.value = state.browser.url || elements.addressInput.value
  } else {
    elements.addressInput.setAttribute('disabled', 'disabled')
    elements.goBack.disabled = true
    elements.goForward.disabled = true
    elements.reload.disabled = true
  }

  elements.pageTitle.textContent = state.activeApp === 'browser'
    ? (state.browser.title || 'Loiterly Browser')
    : state.activeApp[0].toUpperCase() + state.activeApp.slice(1)

  elements.pageStatus.textContent = state.activeApp === 'browser'
    ? (state.browser.isLoading ? 'Loading...' : 'Ready')
    : 'Persistent view'

  elements.globalShortcut.textContent = state.globalShortcut
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
  Object.assign(state, nextState)
  if (nextState.browser) {
    state.browser = { ...state.browser, ...nextState.browser }
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
