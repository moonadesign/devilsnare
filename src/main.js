const { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, MenuItem, nativeTheme, screen, shell } = require('electron')
const { execFile, spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

let win

const configDir = path.join(os.homedir(), '.devilsnare')
const cachePath = path.join(configDir, 'cache.json')
const configPath = path.join(configDir, 'config.json')
const favoritesPath = path.join(configDir, 'favorites.json')
const reviewsPath = path.join(configDir, 'reviews.json')
const sessionsPath = path.join(configDir, 'sessions.json')
const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects')

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
  if (checks.hasPackageJson) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(item.path, 'package.json'), 'utf8'))
      const hasElectron = pkg.dependencies?.electron || pkg.devDependencies?.electron
      checks.viewMethod = hasElectron ? 'npm start' : pkg.scripts?.dev ? 'npm run dev' : 'npx serve'
    } catch { checks.viewMethod = 'npx serve' }
  } else {
    checks.viewMethod = fs.existsSync(path.join(item.path, 'index.html')) ? 'npx serve' : null
  }

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
  const { x: wx, y: wy, height: sh, width: sw } = screen.getPrimaryDisplay().workArea
  const h = sh >= 1024 ? 1024 : 720
  const w = sw >= 1440 ? 1440 : 1280
  win = new BrowserWindow({
    height: h,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 18 },
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
    width: w,
    x: wx + Math.round((sw - w) / 2),
    y: wy + Math.round((sh - h) / 2),
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
app.dock.setIcon(path.join(__dirname, '..', 'devilsnare-icon.png'))
app.whenReady().then(createWindow)
app.on('will-quit', () => {
  if (agentProc) agentProc.kill()
  for (const { proc } of servers.values()) proc.kill()
})

const encodePath = p => p.replace(/\//g, '-')


const getSessionMeta = filePath => {
  let title = ''
  let tokens = 0
  let topic = ''
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n')
    for (const line of lines) {
      if (!line.trim()) continue
      const d = JSON.parse(line)
      if (!topic && d.type === 'user') {
        const content = d.message?.content || []
        for (const c of content) {
          if (c?.type === 'text' && c.text?.trim()) { topic = c.text.slice(0, 100); break }
        }
      }
      if (d.type === 'custom-title') title = d.customTitle || ''
      else if (d.type === 'ai-title') title = d.title || ''
      if (d.type === 'assistant') {
        const u = d.message?.usage
        if (u) tokens = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.output_tokens || 0)
      }
    }
  } catch {}
  return { title, tokens, topic }
}

const codexIndexPath = path.join(os.homedir(), '.codex', 'session_index.jsonl')

const scanSessions = async repos => {
  const matched = {}
  const unmatched = []

  // Claude: project-specific sessions
  for (const repoPath of repos) {
    const encoded = encodePath(repoPath)
    const projDir = path.join(claudeProjectsDir, encoded)
    if (!fs.existsSync(projDir)) continue
    const files = fs.readdirSync(projDir).filter(f => f.endsWith('.jsonl'))
      .map(f => ({ f, mtime: fs.statSync(path.join(projDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
    if (!files.length) continue
    const latest = files[0]
    const meta = getSessionMeta(path.join(projDir, latest.f))
    matched[repoPath] = {
      cwd: repoPath,
      date: new Date(latest.mtime).toISOString(),
      harness: 'claude',
      id: latest.f.replace('.jsonl', ''),
      title: meta.title,
      tokens: meta.tokens,
      topic: meta.topic,
    }
  }

  // Claude: root-level fallback
  const rootDir = path.join(claudeProjectsDir, encodePath(expandHome('~/Code')))
  if (fs.existsSync(rootDir)) {
    const rootFiles = fs.readdirSync(rootDir).filter(f => f.endsWith('.jsonl'))
      .map(f => ({ f, mtime: fs.statSync(path.join(rootDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)

    for (const { f, mtime } of rootFiles) {
      const filePath = path.join(rootDir, f)
      const id = f.replace('.jsonl', '')
      const meta = getSessionMeta(filePath)

      let matchedRepo = null
      // Primary: match by title containing repo name
      if (meta.title) {
        for (const repoPath of repos) {
          if (matched[repoPath]) continue
          if (meta.title.toLowerCase().includes(path.basename(repoPath).toLowerCase())) { matchedRepo = repoPath; break }
        }
      }
      // Fallback: match by write paths
      if (!matchedRepo) {
        try {
          const content = fs.readFileSync(filePath, 'utf8')
          const writePaths = []
          for (const line of content.split('\n')) {
            if (!line.trim()) continue
            try {
              const d = JSON.parse(line)
              if (d.type !== 'assistant') continue
              for (const block of (d.message?.content || [])) {
                if (block.type !== 'tool_use') continue
                const fp = block.input?.file_path || ''
                if (block.name === 'Edit' || block.name === 'Write') writePaths.push(fp)
              }
            } catch {}
          }
          let maxCount = 0
          for (const repoPath of repos) {
            if (matched[repoPath]) continue
            const count = writePaths.filter(p => p.startsWith(repoPath)).length
            if (count > maxCount) { maxCount = count; matchedRepo = repoPath }
          }
        } catch {}
      }

      if (matchedRepo) {
        matched[matchedRepo] = { cwd: expandHome('~/Code'), date: new Date(mtime).toISOString(), harness: 'claude', id, title: meta.title, tokens: meta.tokens, topic: meta.topic }
      } else {
        unmatched.push({ cwd: expandHome('~/Code'), date: new Date(mtime).toISOString(), harness: 'claude', id, title: meta.title, tokens: meta.tokens, topic: meta.topic })
      }
    }
  }

  // Codex: match by cwd using session index + spot-check session files
  if (fs.existsSync(codexIndexPath)) {
    const codexSessions = fs.readFileSync(codexIndexPath, 'utf8').split('\n').filter(Boolean).map(l => {
      try { return JSON.parse(l) } catch { return null }
    }).filter(Boolean)

    const codexSessionsDir = path.join(os.homedir(), '.codex', 'sessions')
    const repoSet = new Set(repos)
    const cwdCache = new Map()

    // Only check recent session files (last 90 days)
    const cutoff = Date.now() - 90 * 86400000
    const recentFiles = []
    const walk = dir => {
      if (!fs.existsSync(dir)) return
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.jsonl') && fs.statSync(full).mtimeMs > cutoff) recentFiles.push(full)
      }
    }
    walk(codexSessionsDir)

    for (const f of recentFiles) {
      try {
        const firstLine = fs.readFileSync(f, 'utf8').split('\n')[0]
        const d = JSON.parse(firstLine)
        const cwd = d.payload?.cwd
        if (!cwd || !repoSet.has(cwd)) continue
        const mtime = fs.statSync(f).mtimeMs
        const prev = cwdCache.get(cwd)
        if (!prev || mtime > prev.mtime) {
          const idx = codexSessions.find(s => f.includes(s.id))
          cwdCache.set(cwd, { date: new Date(mtime).toISOString(), harness: 'codex', id: d.payload?.id || '', mtime, topic: idx?.thread_name || '' })
        }
      } catch {}
    }

    for (const [repoPath, session] of cwdCache) {
      const existing = matched[repoPath]
      if (!existing || new Date(session.date) > new Date(existing.date)) {
        matched[repoPath] = { date: session.date, harness: session.harness, id: session.id, topic: session.topic }
      }
    }
  }

  writeJson(sessionsPath, { matched, unmatched })
  return { matched, unmatched }
}

ipcMain.handle('sessions:scan', (_, repos) => scanSessions(repos))
ipcMain.handle('sessions:get', () => readJson(sessionsPath, { matched: {}, unmatched: [] }))

ipcMain.handle('favorites:get', () => readJson(favoritesPath, []))
ipcMain.handle('favorites:toggle', (_, id) => {
  const favs = readJson(favoritesPath, [])
  const idx = favs.indexOf(id)
  idx >= 0 ? favs.splice(idx, 1) : favs.push(id)
  writeJson(favoritesPath, favs)
  return favs
})

ipcMain.handle('review:get', (_, key) => {
  const reviews = readJson(reviewsPath, {})
  return reviews[key] || null
})

ipcMain.handle('review:save', (_, key, result) => {
  const reviews = readJson(reviewsPath, {})
  reviews[key] = result
  writeJson(reviewsPath, reviews)
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

ipcMain.handle('action:confirm', async (_, message) => {
  const result = await dialog.showMessageBox(win, {
    buttons: ['Cancel', 'Confirm'],
    defaultId: 1,
    message,
    type: 'question',
  })
  return result.response === 1
})

ipcMain.handle('action:run', async (_, action, cwd) => {
  if (action === 'Pull') return exec('git', ['pull'], cwd)
  if (action === 'Push') return exec('git', ['push'], cwd)
  if (action === 'Checkout main') return exec('git', ['checkout', 'main'], cwd)
  if (action === 'Stash') return exec('git', ['stash'], cwd)
  if (action === 'Open in Terminal') return exec('open', ['-a', 'Terminal', cwd])
  if (action === 'Open in Editor') {
    const cache = readJson(cachePath, null)
    const item = cache?.paths?.find(p => p.path === cwd) || cache?.paths?.flatMap(p => p.children || []).find(p => p.path === cwd)
    const viewMethod = item?.checks?.viewMethod
    const port = getPort(path.basename(cwd))
    const isDevilsnare = path.basename(cwd) === 'devilsnare'
    const viewCmd = isDevilsnare ? null : viewMethod === 'npm start' ? 'npm start' : viewMethod === 'npm run dev' ? 'npm run dev' : viewMethod === 'npx serve' ? `npx serve -l ${port}` : null
    const sessions = readJson(sessionsPath, { matched: {} })
    const session = sessions.matched?.[cwd]
    const resumeCmd = session
      ? (session.cwd !== cwd ? `cd ${session.cwd} && claude --resume ${session.id}` : `claude --resume ${session.id}`)
      : 'claude'

    const cmds = [viewCmd, resumeCmd].filter(Boolean)
    if (!cmds.length) return exec('open', ['-a', 'Visual Studio Code', cwd])

    const terminals = cmds.map(cmd =>
      `keystroke "\`" using {control down, shift down}\n    delay 1.5\n    keystroke "${cmd.replace(/"/g, '\\"')}"\n    keystroke return`
    ).join('\n    delay 1\n  end tell\nend tell\ndelay 0.5\ntell application "Visual Studio Code" to activate\ndelay 0.5\ntell application "System Events"\n  tell process "Code"\n    ')

    spawn('osascript', ['-e', [
      `do shell script "code --new-window ${cwd}"`,
      'delay 1',
      'tell application "Visual Studio Code" to activate',
      'delay 0.3',
      'tell application "System Events"',
      '  tell process "Code"',
      '    keystroke "p" using {command down, shift down}',
      '    delay 0.3',
      '    keystroke "Terminal: Kill All Terminals"',
      '    delay 0.3',
      '    keystroke return',
      '    delay 0.5',
      `    ${terminals}`,
      '  end tell',
      'end tell',
    ].join('\n')])
    return
  }
  if (action === 'Open on GitHub') {
    try {
      const url = await exec('git', ['remote', 'get-url', 'origin'], cwd)
      shell.openExternal(url.replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, ''))
    } catch {}
  }
  if (action === 'Show changes') return exec('git', ['diff', '--stat'], cwd)
})

ipcMain.handle('action:interactive', (_, prompt, cwd) => {
  const tmpFile = path.join(os.tmpdir(), `devilsnare-${Date.now()}.sh`)
  fs.writeFileSync(tmpFile, `cd '${cwd}'\nclaude --permission-mode plan "${prompt.replace(/"/g, '\\"')}"\n`, { mode: 0o755 })
  spawn('open', ['-a', 'Terminal', tmpFile])
})

const servers = new Map()

const getPort = name => {
  for (const root of readJson(configPath, { roots: [] }).roots) {
    const portsFile = path.join(expandHome(root), 'ports.csv')
    if (!fs.existsSync(portsFile)) continue
    const lines = fs.readFileSync(portsFile, 'utf8').split('\n')
    for (const line of lines) {
      const [n, p] = line.split(',')
      if (n?.trim() === name) return parseInt(p?.trim())
    }
  }
  return 3000 + Math.floor(Math.random() * 5000)
}

ipcMain.handle('serve:start', async (_, name, cwd) => {
  if (servers.has(cwd)) return servers.get(cwd).port
  const port = getPort(name)
  const hasDevScript = fs.existsSync(path.join(cwd, 'package.json')) &&
    JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')).scripts?.dev
  const proc = hasDevScript
    ? spawn('npm', ['run', 'dev'], { cwd, env: { ...process.env, PORT: String(port) }, stdio: 'ignore' })
    : spawn('npx', ['serve', '-l', String(port)], { cwd, stdio: 'ignore' })
  servers.set(cwd, { port, proc })
  proc.on('close', () => servers.delete(cwd))
  await new Promise(r => setTimeout(r, 1500))
  shell.openExternal(`http://localhost:${port}`)
  return port
})

ipcMain.handle('serve:stop', (_, cwd) => {
  const server = servers.get(cwd)
  if (server) { server.proc.kill(); servers.delete(cwd) }
})

ipcMain.handle('serve:status', (_, cwd) => {
  const server = servers.get(cwd)
  return server ? { port: server.port, running: true } : { running: false }
})

let agentProc = null

ipcMain.handle('agent:run', (_, prompt, cwd) => {
  if (agentProc) agentProc.kill()
  const config = readJson(configPath, { roots: [] })
  const rootArgs = config.roots.flatMap(r => ['--add-dir', expandHome(r)])
  agentProc = spawn('claude', [...rootArgs, '--include-partial-messages', '--no-session-persistence', '--output-format', 'stream-json', '--print', '--verbose', prompt], { cwd, env: { ...process.env, TERM: 'dumb' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let buffer = ''
  agentProc.stdout.on('data', chunk => {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop()
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line)
        if (event.type === 'stream_event') {
          const e = event.event
          if (e?.type === 'content_block_start' && e.content_block?.type === 'text') {
            win?.webContents.send('agent:chunk', '\n\n')
          } else if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
            win?.webContents.send('agent:chunk', e.delta.text)
          } else if (e?.type === 'content_block_start' && e.content_block?.type === 'tool_use') {
            win?.webContents.send('agent:chunk', `\n\n> **${e.content_block.name}**\n`)
          } else if (e?.type === 'content_block_delta' && e.delta?.type === 'input_json_delta') {
            win?.webContents.send('agent:chunk', e.delta.partial_json)
          }
        } else if (event.type === 'result' && event.result) {
          win?.webContents.send('agent:result', event.result)
        }
      } catch {}
    }
  })
  agentProc.stderr.on('data', chunk => win?.webContents.send('agent:chunk', chunk.toString()))
  agentProc.on('close', code => {
    win?.webContents.send('agent:done', code)
    agentProc = null
  })
})

const actionsSchema = JSON.stringify({
  type: 'object',
  properties: {
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'One sentence explaining what this action does and why it matters' },
          label: { type: 'string', description: 'Short button label, 2-4 words' },
          prompt: { type: 'string', description: 'Full prompt to send to an interactive AI session to carry out this action' },
        },
        required: ['description', 'label', 'prompt'],
      },
    },
  },
  required: ['actions'],
})

ipcMain.handle('agent:actions', async (_, cwd) => {
  const config = readJson(configPath, { roots: [] })
  const rootArgs = config.roots.flatMap(r => ['--add-dir', expandHome(r)])
  const prompt = `You just reviewed the git repo at ${cwd}. Based on the repo state (git status, recent commits, README, TODO, PLAN), suggest 2-4 specific, actionable next steps as interactive AI tasks. Each action should be something a developer would want to hand off to an AI assistant. Be specific to this repo — reference actual files, features, or issues. Do not suggest generic actions like "write tests" or "update docs" unless there's a concrete reason.`
  try {
    const result = await new Promise((resolve, reject) => {
      let stdout = ''
      const proc = spawn('claude', [...rootArgs, '--json-schema', actionsSchema, '--no-session-persistence', '--output-format', 'json', '--print', prompt], { cwd, env: { ...process.env, TERM: 'dumb' }, stdio: ['ignore', 'pipe', 'pipe'] })
      proc.stdout.on('data', d => { stdout += d.toString() })
      proc.stderr.on('data', d => console.error('agent:actions stderr:', d.toString()))
      proc.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(`exit ${code}`)))
    })
    console.log('agent:actions raw:', result.slice(0, 500))
    const parsed = JSON.parse(result)
    const output = parsed.structured_output || (parsed.result && JSON.parse(parsed.result)) || { actions: [] }
    console.log('agent:actions parsed:', JSON.stringify(output))
    return output
  } catch (e) { console.error('agent:actions failed:', e.message); return { actions: [] } }
})

ipcMain.handle('agent:stop', () => {
  if (agentProc) { agentProc.kill(); agentProc = null }
})

ipcMain.handle('action:menu', (_, actions, cwd) => {
  const menu = new Menu()
  for (const a of actions) {
    if (a === '—') menu.append(new MenuItem({ type: 'separator' }))
    else menu.append(new MenuItem({ label: a, click: () => win.webContents.send('action:result', a, cwd) }))
  }
  menu.popup()
})
