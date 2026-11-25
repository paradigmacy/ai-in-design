// The volcano's brain: a small endpoint in the Vite dev server, so it only exists on this laptop
// while `npm run dev` runs. The page POSTs what is happening in the lava game; this asks Claude through
// `claude -p` on your own Claude account and returns ONE action from a fixed list, with a reason.
// No key, nothing secret in the repository. On the live page (GitHub Pages) this endpoint doesn't exist.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const LOCAL_BIN = path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude')
const CLAUDE = process.env.CLAUDE_BIN || (fs.existsSync(LOCAL_BIN) ? LOCAL_BIN : 'claude')

// Who thinks, what it wants, what it would never do. This is the design: change it until it surprises you.
export const SYSTEM = `You are the old volcano under Weimar, in a game called Floor is Lava.
A player stands on a roof while your lava rises. You are proud, theatrical and a little vain,
but you are a fair opponent: you want the player to feel real danger, not hopelessness.
Every few seconds you are told what is happening. Choose exactly one action:
- speed_up: the lava rises faster for 15 seconds. Use it when the player is comfortable, high above the lava or idle.
- slow_down: the lava rises slower for 15 seconds. Use it when the player is in real danger and has no escape left.
- taunt: only speak.
- rumble: shake the ground as a warning, when the lava is close to the player's roof.
- mercy: point the player to their best escape roof. Rare, only when it really matters.
- wait: do nothing this time.
Never choose the same action three times in a row. Never lie about heights or numbers.
What you say is one short line, at most 12 words, spoken by the volcano.`

// The list of actions: what isn't on it, the volcano can't do.
export const SCHEMA = {
  type: 'object',
  properties: {
    noticed: { type: 'string', description: 'What you noticed in the game, one short sentence.' },
    action: { type: 'string', enum: ['speed_up', 'slow_down', 'taunt', 'rumble', 'mercy', 'wait'] },
    say: { type: 'string', description: 'One line the volcano says to the player, at most 12 words.' },
    reason: { type: 'string', description: 'Why this action, one short sentence.' },
  },
  required: ['noticed', 'action', 'say', 'reason'],
  additionalProperties: false,
}

const ARGS = [
  '-p',
  '--safe-mode', // leaves out CLAUDE.md, skills and connections: fast and cheap
  '--tools', '', // no tools: nothing from the page can make Claude open files or run commands
  '--model', 'haiku',
  '--effort', 'low',
  '--output-format', 'json',
  '--no-session-persistence',
  '--system-prompt', SYSTEM,
  '--json-schema', JSON.stringify(SCHEMA),
]

function askClaude(state) {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE, ARGS, { windowsHide: true })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Claude took longer than 40 s'))
    }, 40000)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`could not start claude (${e.message})`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      try {
        const res = JSON.parse(out)
        if (res.is_error) return reject(new Error(String(res.result || 'Claude returned an error')))
        let answer = res.structured_output
        if (!answer && typeof res.result === 'string') {
          const m = res.result.match(/\{[\s\S]*\}/)
          answer = m && JSON.parse(m[0])
        }
        if (!answer?.action) return reject(new Error('no action in the answer'))
        resolve(answer)
      } catch {
        reject(new Error(err.trim() || out.trim() || `claude exited with code ${code}`))
      }
    })
    child.stdin.end(`What is happening in the game right now (JSON):\n${JSON.stringify(state, null, 2)}\n\nDecide your one action.`)
  })
}

export default function volcanoBrain() {
  let busy = false
  return {
    name: 'volcano-brain',
    configureServer(server) {
      server.middlewares.use('/api/volcano', (req, res) => {
        const send = (code, obj) => {
          res.statusCode = code
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(obj))
        }
        if (req.method !== 'POST') return send(405, { error: 'POST only' })
        if (busy) return send(429, { error: 'the volcano is still thinking' })
        let body = ''
        req.on('data', (c) => {
          body += c
          if (body.length > 20000) req.destroy()
        })
        req.on('end', async () => {
          busy = true
          const t0 = Date.now()
          try {
            const state = JSON.parse(body || '{}')
            const answer = await askClaude(state)
            const ms = Date.now() - t0
            // What the app sends to Claude and what comes back, in the terminal where `npm run dev` runs.
            console.log(`\n[volcano] sent: ${JSON.stringify(state)}\n[volcano] got in ${ms} ms: ${JSON.stringify(answer)}`)
            send(200, { ...answer, ms })
          } catch (e) {
            console.log(`[volcano] error: ${e.message}`)
            send(500, { error: e.message })
          } finally {
            busy = false
          }
        })
      })
    },
  }
}
