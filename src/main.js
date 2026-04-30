const { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, MenuItem, nativeTheme, screen, shell } = require('electron')
const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

let win

const configDir = path.join(os.homedir(), '.devilsnare')
const cachePath = path.join(configDir, 'cache.json')
const configPath = path.join(configDir, 'config.json')
const favoritesPath = path.join(configDir, 'favorites.json')

const expandHome = p => p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p
const readJson = (p, fallback) => fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fallback
const writeJson = (p, data) => fs.writeFileSync(p, JSON.stringify(data, null, 2))

const ensureConfig = () => {
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true })
  if (!fs.existsSync(configPath)) writeJson(configPath, { roots: [] })
}

const exec = (cmd, args, cwd) => new Promise((resolve, reject) => {
  execFile(cmd, args, { cwd, timeout: 10000 }, (err, stdout) => err ? reject(err) : resolve(stdout.trim()))
})

const scanRoot = async rootPath => {
  const expanded = expandHome(rootPath)
  const entries = fs.readdirSync(expanded, { withFileTypes: true })
  const paths = []

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const fullPath = path.join(expanded, entry.name)
    if (!fs.existsSync(path.join(fullPath, '.git'))) continue

    const isMonorepo = fs.existsSync(path.join(fullPath, '.gitmodules'))
    const item = { name: entry.name, path: fullPath, type: isMonorepo ? 'monorepo' : 'repo', children: [] }
    if (isMonorepo) item.children = await scanSubmodules(fullPath)
    paths.push(item)
  }

  return paths
}

const scanSubmodules = async repoPath => {
  const modulesFile = path.join(repoPath, '.gitmodules')
  if (!fs.existsSync(modulesFile)) return []

  const content = fs.readFileSync(modulesFile, 'utf8')
  const children = []
  const regex = /\[submodule "([^"]+)"\]\s*path\s*=\s*(.+)/g
  let match

  while ((match = regex.exec(content)) !== null) {
    const subPath = match[2].trim()
    const fullPath = path.join(repoPath, subPath)
    if (!fs.existsSync(fullPath)) continue
    const hasSubmodules = fs.existsSync(path.join(fullPath, '.gitmodules'))
    children.push({ name: subPath, path: fullPath, type: hasSubmodules ? 'monorepo' : 'submodule', children: [] })
  }

  return children
}

const checkPath = async item => {
  const checks = {}

  try {
    const status = await exec('git', ['status', '--porcelain'], item.path)
    checks.dirty = status.length > 0
    checks.changedFiles = status ? status.split('\n').length : 0
  } catch { checks.dirty = null }

  try {
    checks.branch = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], item.path)
  } catch { checks.branch = null }

  try {
    checks.lastCommit = (await exec('git', ['log', '-1', '--format=%ci'], item.path)) || null
  } catch { checks.lastCommit = null }

  try {
    const remote = await exec('git', ['remote'], item.path)
    checks.hasRemote = remote.length > 0
    if (checks.hasRemote && checks.branch && checks.branch !== 'HEAD') {
      try {
        checks.ahead = parseInt(await exec('git', ['rev-list', '--count', `origin/${checks.branch}..HEAD`], item.path)) || 0
        checks.behind = parseInt(await exec('git', ['rev-list', '--count', `HEAD..origin/${checks.branch}`], item.path)) || 0
      } catch { checks.ahead = 0; checks.behind = 0 }
    }
  } catch { checks.hasRemote = false }

  try {
    checks.diskKB = parseInt((await exec('du', ['-sk', item.path])).split('\t')[0]) || 0
  } catch { checks.diskKB = null }

  try {
    const recent = await exec('find', [item.path, '-maxdepth', '2', '-not', '-path', '*/node_modules/*', '-not', '-path', '*/.git/*', '-not', '-path', '*/build/*', '-type', 'f', '-print0'], item.path)
    let latest = 0
    for (const f of recent.split('\0').filter(Boolean)) {
      try { latest = Math.max(latest, fs.statSync(f).mtimeMs) } catch {}
    }
    checks.lastModified = latest ? new Date(latest).toISOString() : null
  } catch { checks.lastModified = null }

  checks.hasPackageJson = fs.existsSync(path.join(item.path, 'package.json'))
  checks.hasNodeModules = fs.existsSync(path.join(item.path, 'node_modules'))
  checks.hasEnv = fs.existsSync(path.join(item.path, '.env'))

  if (checks.hasNodeModules) {
    try {
      checks.nodeModulesKB = parseInt((await exec('du', ['-sk', path.join(item.path, 'node_modules')])).split('\t')[0]) || 0
    } catch { checks.nodeModulesKB = 0 }
  } else {
    checks.nodeModulesKB = 0
  }

  return { ...item, checks }
}

const scan = async () => {
  ensureConfig()
  const config = readJson(configPath, { roots: [] })
  const allPaths = []
  for (const root of config.roots) allPaths.push(...await scanRoot(root))

  const results = []
  for (const item of allPaths) {
    const checked = await checkPath(item)
    if (checked.children.length) checked.children = await Promise.all(checked.children.map(checkPath))
    results.push(checked)
  }

  writeJson(cachePath, { timestamp: Date.now(), paths: results })
  return results
}

const createWindow = () => {
  const { height: sh, width: sw } = screen.getPrimaryDisplay().workAreaSize
  win = new BrowserWindow({
    height: sh >= 1024 ? 1024 : 720,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 18 },
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
    width: sw >= 1440 ? 1440 : 1280,
  })
  win.loadFile(path.join(__dirname, 'index.html'))
  win.webContents.on('context-menu', (_, p) => {
    const menu = new Menu()
    menu.append(new MenuItem({ label: 'Inspect Element', click: () => win.webContents.inspectElement(p.x, p.y) }))
    menu.popup()
  })
  globalShortcut.register('CommandOrControl+Option+I', () => win.webContents.toggleDevTools())
}

app.setName('Devilsnare')
app.whenReady().then(createWindow)

ipcMain.handle('favorites:get', () => readJson(favoritesPath, []))
ipcMain.handle('favorites:toggle', (_, id) => {
  const favs = readJson(favoritesPath, [])
  const idx = favs.indexOf(id)
  idx >= 0 ? favs.splice(idx, 1) : favs.push(id)
  writeJson(favoritesPath, favs)
  return favs
})

ipcMain.handle('scan', scan)
ipcMain.handle('scan:cached', () => readJson(cachePath, null))
ipcMain.handle('check:path', (_, item) => checkPath(item))
ipcMain.handle('config:get', () => { ensureConfig(); return readJson(configPath, { roots: [] }) })
ipcMain.handle('config:save', (_, config) => { writeJson(configPath, config); return config })
ipcMain.handle('dialog:folder', async () => {
  const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
  return result.canceled ? null : result.filePaths[0]
})
ipcMain.handle('theme:set', (_, mode) => { nativeTheme.themeSource = mode })

ipcMain.handle('action:run', async (_, action, cwd) => {
  if (action === 'Pull') return exec('git', ['pull'], cwd)
  if (action === 'Push') return exec('git', ['push'], cwd)
  if (action === 'Checkout main') return exec('git', ['checkout', 'main'], cwd)
  if (action === 'Stash') return exec('git', ['stash'], cwd)
  if (action === 'Open in Terminal') return exec('open', ['-a', 'Terminal', cwd])
  if (action === 'Open in Editor') return exec('open', ['-a', 'Visual Studio Code', cwd])
  if (action === 'Open on GitHub') {
    try {
      const url = await exec('git', ['remote', 'get-url', 'origin'], cwd)
      shell.openExternal(url.replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, ''))
    } catch {}
  }
  if (action === 'Show changes') return exec('git', ['diff', '--stat'], cwd)
})

ipcMain.handle('action:menu', (_, actions, cwd) => {
  const menu = new Menu()
  for (const a of actions) {
    if (a === '—') menu.append(new MenuItem({ type: 'separator' }))
    else menu.append(new MenuItem({ label: a, click: () => win.webContents.send('action:result', a, cwd) }))
  }
  menu.popup()
})
