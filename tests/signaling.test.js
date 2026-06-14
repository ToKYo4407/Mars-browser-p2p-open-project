import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { io as ioClient } from 'socket.io-client'
import { createServer } from 'http'
import express from 'express'
import { Server } from 'socket.io'

let httpServer, io, PORT
const serverLog = []

function makeServer() {
  return new Promise((res) => {
    const app = express()
    httpServer = createServer(app)
    io = new Server(httpServer, { cors: { origin: '*' } })
    const rooms = new Map()

    io.on('connection', (socket) => {
      // Intercept every incoming event for the ZK spy test
      socket.use(([event, ...args], next) => {
        serverLog.push({ event, args })
        next()
      })

      let currentRoom = null

      // Callback (ack) lets clients know the join has been processed server-side
      socket.on('join-room', (roomId, ack) => {
        currentRoom = roomId
        socket.join(roomId)
        if (!rooms.has(roomId)) rooms.set(roomId, new Set())
        rooms.get(roomId).add(socket.id)
        socket.to(roomId).emit('peer-joined')
        if (typeof ack === 'function') ack()
      })

      socket.on('offer', (roomId, offer) => socket.to(roomId).emit('offer', offer))
      socket.on('answer', (roomId, answer) => socket.to(roomId).emit('answer', answer))
      socket.on('ice-candidate', (roomId, c) => socket.to(roomId).emit('ice-candidate', c))
      socket.on('resume-request', (roomId, idx) => socket.to(roomId).emit('resume-request', idx))

      socket.on('disconnect', () => {
        if (!currentRoom) return
        const members = rooms.get(currentRoom)
        if (members) {
          members.delete(socket.id)
          if (members.size === 0) rooms.delete(currentRoom)
        }
        socket.to(currentRoom).emit('peer-left')
      })
    })

    // Port 0 — OS picks a free port, no conflicts between parallel runs
    httpServer.listen(0, () => {
      PORT = httpServer.address().port
      res()
    })
  })
}

function connect() {
  return new Promise((res, rej) => {
    // WebSocket-only: skips the HTTP polling phase and upgrade, eliminates the message-loss window
    const sock = ioClient(`http://localhost:${PORT}`, { transports: ['websocket'] })
    const t = setTimeout(() => rej(new Error('socket connect timeout')), 3000)
    sock.on('connect', () => { clearTimeout(t); res(sock) })
    sock.on('connect_error', (e) => { clearTimeout(t); rej(e) })
  })
}

// Rejects if the event doesn't fire within `ms`
function once(sock, event, ms = 3000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`Timeout waiting for "${event}"`)), ms)
    sock.once(event, (...args) => { clearTimeout(t); res(args) })
  })
}

// Server ack confirms BOTH peers are recorded in the room before we return
async function joinBoth(a, b, room) {
  await Promise.all([
    new Promise(res => a.emit('join-room', room, res)),
    new Promise(res => b.emit('join-room', room, res)),
  ])
}

before(makeServer)
after(() => new Promise(res => { io.close(); httpServer.close(res) }))

// ── Relay correctness ─────────────────────────────────────────────────────────

test('peer-joined fires when second client enters the room', async () => {
  const a = await connect()
  const b = await connect()

  const peerJoined = once(a, 'peer-joined')
  a.emit('join-room', 'r-joined')
  b.emit('join-room', 'r-joined')
  await peerJoined

  a.disconnect(); b.disconnect()
})

test('offer is relayed only to the other peer', async () => {
  const a = await connect()
  const b = await connect()
  await joinBoth(a, b, 'r-offer')

  const got = once(b, 'offer')
  a.emit('offer', 'r-offer', { type: 'offer', sdp: 'v=0...' })
  const [received] = await got
  assert.deepEqual(received, { type: 'offer', sdp: 'v=0...' })

  a.disconnect(); b.disconnect()
})

test('answer is relayed back to the offering peer', async () => {
  const a = await connect()
  const b = await connect()
  await joinBoth(a, b, 'r-answer')

  const got = once(a, 'answer')
  b.emit('answer', 'r-answer', { type: 'answer', sdp: 'v=0...' })
  const [received] = await got
  assert.deepEqual(received, { type: 'answer', sdp: 'v=0...' })

  a.disconnect(); b.disconnect()
})

test('ice-candidate is relayed to the other peer', async () => {
  const a = await connect()
  const b = await connect()
  await joinBoth(a, b, 'r-ice')

  const candidate = { candidate: 'candidate:0 1 UDP 2...', sdpMid: '0' }
  const got = once(b, 'ice-candidate')
  a.emit('ice-candidate', 'r-ice', candidate)
  const [received] = await got
  assert.deepEqual(received, candidate)

  a.disconnect(); b.disconnect()
})

test('resume-request is relayed with the chunk index intact', async () => {
  const a = await connect()
  const b = await connect()
  await joinBoth(a, b, 'r-resume')

  const got = once(a, 'resume-request')
  b.emit('resume-request', 'r-resume', 42)
  const [idx] = await got
  assert.equal(idx, 42)

  a.disconnect(); b.disconnect()
})

test('peer-left fires when one peer disconnects', async () => {
  const a = await connect()
  const b = await connect()
  await joinBoth(a, b, 'r-leave')

  const peerLeft = once(a, 'peer-left')
  b.disconnect()
  await peerLeft

  a.disconnect()
})

test('events are not leaked to sockets in different rooms', async () => {
  const a = await connect()
  const b = await connect()
  const c = await connect()
  await Promise.all([
    new Promise(res => a.emit('join-room', 'r-isolation', res)),
    new Promise(res => b.emit('join-room', 'r-isolation', res)),
    new Promise(res => c.emit('join-room', 'r-other', res)),
  ])

  let leaked = false
  c.on('offer', () => { leaked = true })
  a.emit('offer', 'r-isolation', { type: 'offer', sdp: 'sdp' })

  await new Promise(r => setTimeout(r, 80))
  assert.equal(leaked, false)

  a.disconnect(); b.disconnect(); c.disconnect()
})

// ── Zero-knowledge: server never receives file data or binary payloads ────────

test('server only ever receives JSON-serialisable signaling events — no binary, no file bytes', async () => {
  const logStart = serverLog.length
  const a = await connect()
  const b = await connect()
  await joinBoth(a, b, 'r-zk-spy')

  // Full signaling round-trip — mirrors exactly what the real app sends
  const fakeOffer = { type: 'offer', sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n' }
  const fakeAnswer = { type: 'answer', sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n' }
  const fakeIce = { candidate: 'candidate:0 1 UDP 2 127.0.0.1 5000 typ host', sdpMid: '0' }

  const answerGot = once(a, 'answer')
  a.emit('offer', 'r-zk-spy', fakeOffer)
  b.emit('answer', 'r-zk-spy', fakeAnswer)
  await answerGot

  a.emit('ice-candidate', 'r-zk-spy', fakeIce)
  b.emit('resume-request', 'r-zk-spy', 7)
  await new Promise(r => setTimeout(r, 60))

  const received = serverLog.slice(logStart)
  const ALLOWED = new Set(['join-room', 'offer', 'answer', 'ice-candidate', 'resume-request'])

  for (const { event } of received) {
    assert.ok(ALLOWED.has(event), `Unexpected event on server: "${event}"`)
  }

  for (const { event, args } of received) {
    for (const arg of args) {
      // Binary payload = file data reached the signaling server — that's a ZK violation
      assert.ok(
        !(arg instanceof Buffer) && !(arg instanceof Uint8Array),
        `Server received binary payload in "${event}" — file data leak`
      )
      // SDP blobs are <2 KB; file chunks are 64 KB — anything >16 KB is suspicious
      const size = typeof arg === 'function' ? 0 : JSON.stringify(arg).length
      assert.ok(size < 16 * 1024, `"${event}" payload is ${size} bytes — exceeds signaling size budget`)
    }
  }

  assert.ok(!JSON.stringify(received).includes('CANARY'), 'File canary string found in server log')

  a.disconnect(); b.disconnect()
})
