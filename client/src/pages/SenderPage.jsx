import { useState, useRef, useEffect, useCallback } from 'react'
import { io } from 'socket.io-client'
import DropZone from '../components/DropZone.jsx'
import StatusPanel from '../components/StatusPanel.jsx'
import ShareLink from '../components/ShareLink.jsx'
import { generateKey, keyToBase64, encryptChunk, generateIV, sha256 } from '../utils/crypto.js'
import { createPeerConnection, CHUNK_SIZE } from '../utils/webrtc.js'

export default function SenderPage() {
  const [file, setFile] = useState(null)
  const [shareUrl, setShareUrl] = useState('')
  const [connStatus, setConnStatus] = useState('idle')
  const [progress, setProgress] = useState(0)
  const [speed, setSpeed] = useState('')
  const [peerLeft, setPeerLeft] = useState(false)
  const [done, setDone] = useState(false)

  const socketRef = useRef(null)
  const pcRef = useRef(null)
  const channelRef = useRef(null)
  const cryptoKeyRef = useRef(null)
  const encryptedChunksRef = useRef([])
  const fileHashRef = useRef('')
  // Guard: ignore duplicate peer-joined events while a session is in progress
  const negotiatingRef = useRef(false)
  // Mutable object so startWebRTC can reset it without breaking the closure reference
  const iceBufRef = useRef({ items: [], ready: false })

  const cleanup = useCallback(() => {
    channelRef.current?.close()
    pcRef.current?.close()
    channelRef.current = null
    pcRef.current = null
  }, [])

  useEffect(() => () => {
    cleanup()
    socketRef.current?.disconnect()
  }, [cleanup])

  async function handleFile(f) {
    setFile(f)
    setPeerLeft(false)
    setDone(false)
    setProgress(0)
    setSpeed('')
    negotiatingRef.current = false

    const roomId = crypto.randomUUID()
    const key = await generateKey()
    const keyB64 = await keyToBase64(key)

    cryptoKeyRef.current = key

    const url = `${window.location.origin}${window.location.pathname}#room=${roomId}&key=${encodeURIComponent(keyB64)}`
    setShareUrl(url)

    const buf = await f.arrayBuffer()
    fileHashRef.current = await sha256(buf)
    const bytes = new Uint8Array(buf)
    const chunks = []
    for (let i = 0; i * CHUNK_SIZE < bytes.length; i++) {
      const slice = bytes.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
      const iv = generateIV()
      const cipher = await encryptChunk(key, iv, slice)
      chunks.push({ iv, cipher })
    }
    encryptedChunksRef.current = chunks

    connectSignaling(roomId)
  }

  function connectSignaling(roomId) {
    socketRef.current?.disconnect()
    setConnStatus('connecting')
    const socket = io('http://localhost:3001')
    socketRef.current = socket

    socket.on('connect', () => {
      console.log('[sender] socket connected, joining room', roomId)
      socket.emit('join-room', roomId)
      setConnStatus('waiting')
    })

    socket.on('connect_error', (e) => console.error('[sender] connect_error', e.message))

    socket.on('peer-joined', () => {
      // Ignore if we already have an active or in-progress WebRTC session
      if (negotiatingRef.current) {
        console.log('[sender] peer-joined ignored — already negotiating')
        return
      }
      negotiatingRef.current = true
      console.log('[sender] peer-joined → starting WebRTC')
      setPeerLeft(false)
      setConnStatus('connecting')
      startWebRTC(roomId)
    })

    socket.on('answer', async (answer) => {
      console.log('[sender] answer received, ICE state:', pcRef.current?.iceConnectionState)
      if (pcRef.current?.signalingState !== 'stable') {
        await pcRef.current?.setRemoteDescription(answer)
      }
      iceBufRef.current.ready = true
      for (const c of iceBufRef.current.items) {
        await pcRef.current?.addIceCandidate(c).catch(err => {
        console.error('addIceCandidate failed', err)
      })
      }
      iceBufRef.current.items = []
    })

    socket.on('ice-candidate', (candidate) => {
      console.log('[sender] REMOTE ICE', candidate)
      const ice = new RTCIceCandidate(candidate)

      if (iceBufRef.current.ready && pcRef.current) {
        pcRef.current.addIceCandidate(ice)
          .catch(console.error)
      } else {
        iceBufRef.current.items.push(ice)
      }
    })

    socket.on('resume-request', (lastChunkIndex) => {
      sendChunks(lastChunkIndex + 1)
    })

    socket.on('peer-left', () => {
      negotiatingRef.current = false
      setPeerLeft(true)
      setConnStatus('disconnected')
      cleanup()
    })

    socket.on('disconnect', () => {
      // Reset so the next connect → join-room → peer-joined can start a fresh session
      negotiatingRef.current = false
      setConnStatus('disconnected')
    })
  }

  function startWebRTC(roomId) {
    // Fresh ICE buffer for this session
    iceBufRef.current = { items: [], ready: false }
    cleanup()
    const pc = createPeerConnection()
    console.log("NEW PEER CONNECTION")
    pcRef.current = pc

    const channel = pc.createDataChannel('file', { ordered: true })
    channelRef.current = channel

    channel.binaryType = 'arraybuffer'
    channel.bufferedAmountLowThreshold = 256 * 1024

    channel.onopen = () => {
      console.log("DATA CHANNEL OPEN")
      setConnStatus('connected')
      sendChunks(0)
    }

    channel.onerror = (e) => console.error('DataChannel error', e)

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        console.log('[sender] ICE candidate:', candidate.type)
        socketRef.current.emit('ice-candidate', roomId, candidate)
      }
    }

    pc.onicegatheringstatechange = () => {
      console.log('[sender] ICE gathering:', pc.iceGatheringState)
    }

    pc.onicecandidateerror = (e) => {
      console.error('ICE candidate error', e)
    }

    pc.onconnectionstatechange = () => {
      console.log(
        '[sender] CONNECTION:',
        pc.connectionState
      )
    }

    pc.oniceconnectionstatechange = () => {
      console.log('[sender] ICE state:', pc.iceConnectionState)
      if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
        negotiatingRef.current = false
        setConnStatus('disconnected')
      }
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        console.log('[sender] ICE connected!')
      }
    }

    pc.createOffer().then(async offer => {
      await pc.setLocalDescription(offer)
      console.log('[sender] offer sent')
      socketRef.current.emit('offer', roomId, offer)
    })
  }

  async function sendChunks(startIndex) {
    const channel = channelRef.current
    const chunks = encryptedChunksRef.current
    if (!channel || channel.readyState !== 'open') return

    let sentBytes = 0
    let lastTime = Date.now()

    for (let i = startIndex; i < chunks.length; i++) {
      while (channel.bufferedAmount > 1024 * 1024) {
        await new Promise(r => {
          channel.onbufferedamountlow = r
          setTimeout(r, 100)
        })
      }

      if (channel.readyState !== 'open') return

      const { iv, cipher } = chunks[i]
      const cipherBytes = new Uint8Array(cipher)
      const msg = new ArrayBuffer(4 + 12 + cipherBytes.length)
      const view = new DataView(msg)
      view.setUint32(0, i, false)
      new Uint8Array(msg, 4, 12).set(iv)
      new Uint8Array(msg, 16).set(cipherBytes)

      channel.send(msg)

      sentBytes += cipherBytes.length
      const now = Date.now()
      if (now - lastTime > 300) {
        const mbps = (sentBytes / (1024 * 1024)) / ((now - lastTime) / 1000)
        setSpeed(`${mbps.toFixed(2)} MB/s`)
        sentBytes = 0
        lastTime = now
      }

      setProgress(((i + 1) / chunks.length) * 100)
    }

    channel.send(JSON.stringify({
      type: 'done',
      totalChunks: chunks.length,
      hash: fileHashRef.current
    }))

    setDone(true)
    setSpeed('')
  }

  const statusLabel = file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB` : ''

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '40px 20px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 36, fontWeight: 700, letterSpacing: -1, marginBottom: 4 }}>
            Zawar Ishita Aashish
          </h1>
          <p className="mono" style={{ fontSize: 13, color: '#555' }}>
            Mars Open Project · zero-knowledge · peer-to-peer · encrypted file transfer
          </p>
        </div>

        {!file ? (
          <DropZone onFile={handleFile} />
        ) : (
          <>
            <div className="card" style={{ padding: 16, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 28 }}>📄</span>
              <div>
                <div style={{ fontWeight: 700 }}>{file.name}</div>
                <div className="mono" style={{ fontSize: 12, color: '#555' }}>
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </div>
              </div>
              <div style={{ marginLeft: 'auto' }}>
                {encryptedChunksRef.current.length > 0 && (
                  <span className="tag">
                    {encryptedChunksRef.current.length} chunks
                  </span>
                )}
              </div>
            </div>

            <ShareLink url={shareUrl} />

            <StatusPanel
              status={connStatus === 'waiting' ? 'connecting' : connStatus}
              progress={connStatus === 'connected' || done ? progress : undefined}
              speed={speed}
              label={
                connStatus === 'waiting' ? 'Waiting for receiver...'
                : connStatus === 'idle' ? ''
                : statusLabel
              }
            />

            {done && (
              <div className="notice-success" style={{ marginTop: 12 }}>
                ✓ Transfer complete — hash verified
              </div>
            )}

            {peerLeft && (
              <div className="notice-error" style={{ marginTop: 12 }}>
                ✕ Receiver disconnected. Share the link again to let them reconnect.
              </div>
            )}

            <button
              className="btn"
              style={{ marginTop: 16 }}
              onClick={() => {
                cleanup()
                socketRef.current?.disconnect()
                setFile(null)
                setShareUrl('')
                setConnStatus('idle')
                setProgress(0)
                setDone(false)
                setPeerLeft(false)
                negotiatingRef.current = false
                encryptedChunksRef.current = []
              }}
            >
              ← Send another file
            </button>
          </>
        )}
      </div>
    </div>
  )
}
