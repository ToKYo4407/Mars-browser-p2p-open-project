import { useEffect, useRef, useState, useCallback } from 'react'
import { io } from 'socket.io-client'
import StatusPanel from '../components/StatusPanel.jsx'
import { base64ToKey, decryptChunk, sha256 } from '../utils/crypto.js'
import { createPeerConnection } from '../utils/webrtc.js'

function parseHash() {
  const hash = window.location.hash.slice(1)
  const params = new URLSearchParams(hash)
  return { roomId: params.get('room'), keyB64: params.get('key') }
}

export default function ReceiverPage() {
  const [connStatus, setConnStatus] = useState('connecting')
  const [progress, setProgress] = useState(0)
  const [speed, setSpeed] = useState('')
  const [peerLeft, setPeerLeft] = useState(false)
  const [error, setError] = useState('')
  const [verified, setVerified] = useState(false)
  const [fileName, setFileName] = useState('file')
  const [senderStale, setSenderStale] = useState(false)

  const socketRef = useRef(null)
  const pcRef = useRef(null)
  const cryptoKeyRef = useRef(null)
  // Map of chunkIndex -> Uint8Array (decrypted)
  const chunksRef = useRef(new Map())
  const lastChunkRef = useRef(-1)
  const totalChunksRef = useRef(null)
  const startTimeRef = useRef(null)
  const bytesRef = useRef(0)
  const speedTimerRef = useRef(null)
  const roomIdRef = useRef(null)

  const cleanup = useCallback(() => {
    pcRef.current?.close()
    pcRef.current = null
  }, [])

  useEffect(() => {
    const { roomId, keyB64 } = parseHash()
    if (!roomId || !keyB64) {
      setError('Invalid share link.')
      return
    }

    roomIdRef.current = roomId

    base64ToKey(keyB64).then(key => {
      cryptoKeyRef.current = key
      connectSignaling(roomId)
    }).catch(() => setError('Invalid encryption key in URL.'))

    return () => {
      cleanup()
      socketRef.current?.disconnect()
      clearInterval(speedTimerRef.current)
    }
  }, [cleanup])

  function connectSignaling(roomId) {
    const socket = io('http://localhost:3001')
    socketRef.current = socket

    socket.on('connect', () => {
      console.log('[receiver] socket connected, joining room', roomId)
      socket.emit('join-room', roomId)
    })

    socket.on('connect_error', (e) => console.error('[receiver] connect_error', e.message))

    // If no offer arrives within 15s, the sender's tab is probably closed
    const staleTimer = setTimeout(() => setSenderStale(true), 15000)

    // Candidates that arrive before setRemoteDescription must be buffered, not dropped
    const iceBuf = []
    let remoteReady = false

    socket.on('offer', async (offer) => {
      console.log('[receiver] offer received → creating answer')
      clearTimeout(staleTimer)
      setSenderStale(false)
      // Reset ICE buffer for this negotiation round
      // iceBuf.length = 0
      remoteReady = false
      cleanup()
      const pc = createPeerConnection()
      console.log("NEW PEER CONNECTION")
      pcRef.current = pc

      pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
          console.log('[receiver] ICE candidate:', candidate.type)
          socket.emit('ice-candidate', roomId, candidate)
        }
      }

      pc.onicecandidateerror = (e) => {
      console.error('ICE candidate error', e)
      }

      pc.onconnectionstatechange = () => {
      console.log("PC STATE:", pc.connectionState)
    }

      pc.onconnectionstatechange = () => {
        console.log(
          '[receiver] CONNECTION:',
          pc.connectionState
        )
      }

      pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState
        console.log('[receiver] ICE state:', state)
        if (state === 'connected' || state === 'completed') setConnStatus('connected')
        if (state === 'disconnected' || state === 'failed') {
          setConnStatus('disconnected')
          if (lastChunkRef.current >= 0) {
            socket.emit('resume-request', roomId, lastChunkRef.current)
          }
        }
      }

      pc.ondatachannel = ({ channel }) => {
        console.log('[receiver] DataChannel received')
        channel.binaryType = 'arraybuffer'
        setConnStatus('connected')

        channel.onmessage = ({ data }) => handleMessage(data)
        channel.onerror = e => console.error('DC error', e)
      }

      await pc.setRemoteDescription(offer)
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      console.log('[receiver] answer sent')
      socket.emit('answer', roomId, answer)

      // Flush candidates that arrived before remote description was ready
      remoteReady = true
      for (const c of iceBuf) await pc.addIceCandidate(c).catch(err => {
      console.error('addIceCandidate failed', err)
    })
      iceBuf.length = 0
    })

    socket.on('ice-candidate', (candidate) => {
      console.log('[sender] REMOTE ICE', candidate)
      const ice = new RTCIceCandidate(candidate)

      if (remoteReady && pcRef.current) {
        pcRef.current.addIceCandidate(ice)
          .catch(console.error)
      } else {
        iceBuf.push(ice)
      }
  })

    socket.on('peer-left', () => {
      setPeerLeft(true)
      setConnStatus('disconnected')
    })

    socket.on('disconnect', () => setConnStatus('disconnected'))
  }

  async function handleMessage(data) {
    // JSON string = done signal
    if (typeof data === 'string') {
      try {
        const msg = JSON.parse(data)
        if (msg.type === 'done') {
          clearInterval(speedTimerRef.current)
          setSpeed('')
          await reassembleAndVerify(msg.totalChunks, msg.hash)
        }
      } catch {}
      return
    }

    // Binary: [4-byte index] + [12-byte IV] + [ciphertext]
    const view = new DataView(data)
    const index = view.getUint32(0, false)
    const iv = new Uint8Array(data, 4, 12)
    const ciphertext = new Uint8Array(data, 16)

    try {
      const plain = await decryptChunk(cryptoKeyRef.current, iv, ciphertext)
      chunksRef.current.set(index, new Uint8Array(plain))

      // Track highest contiguous chunk for resume
      while (chunksRef.current.has(lastChunkRef.current + 1)) {
        lastChunkRef.current++
      }

      bytesRef.current += plain.byteLength

      if (!startTimeRef.current) {
        startTimeRef.current = Date.now()
        speedTimerRef.current = setInterval(() => {
          const elapsed = (Date.now() - startTimeRef.current) / 1000
          if (elapsed > 0) {
            const mbps = (bytesRef.current / 1024 / 1024) / elapsed
            setSpeed(`${mbps.toFixed(2)} MB/s`)
          }
        }, 400)
      }

      if (totalChunksRef.current !== null) {
        setProgress((chunksRef.current.size / totalChunksRef.current) * 100)
      }
    } catch (e) {
      console.error('Decryption failed for chunk', index, e)
    }
  }

  async function reassembleAndVerify(totalChunks, senderHash) {
    totalChunksRef.current = totalChunks
    setProgress(100)

    const parts = []
    let totalSize = 0
    for (let i = 0; i < totalChunks; i++) {
      const chunk = chunksRef.current.get(i)
      if (!chunk) {
        setError(`Missing chunk ${i}. Transfer incomplete.`)
        return
      }
      parts.push(chunk)
      totalSize += chunk.length
    }

    const assembled = new Uint8Array(totalSize)
    let offset = 0
    for (const part of parts) {
      assembled.set(part, offset)
      offset += part.length
    }

    const receiverHash = await sha256(assembled.buffer)

    if (receiverHash !== senderHash) {
      setError('Hash mismatch! File may be corrupted.')
      return
    }

    setVerified(true)

    // Trigger download
    const blob = new Blob([assembled])
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '40px 20px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 36, fontWeight: 700, letterSpacing: -1, marginBottom: 4 }}>
            Zawar Ishita Aashish
          </h1>
          <p className="mono" style={{ fontSize: 13, color: '#555' }}>
            receiving encrypted file — decryption key never leaves your browser
          </p>
        </div>

        <div className="card" style={{ padding: 20, marginBottom: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 14, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            File Name
          </div>
          <input
            type="text"
            value={fileName}
            onChange={e => setFileName(e.target.value)}
            placeholder="file"
            style={{
              width: '100%',
              border: '2px solid #0A0A0A',
              padding: '10px 12px',
              fontFamily: 'IBM Plex Mono, monospace',
              fontSize: 14,
              background: '#f5f5f0',
              outline: 'none'
            }}
          />
          <p style={{ fontSize: 12, color: '#555', marginTop: 6 }}>
            Set the filename before the transfer completes.
          </p>
        </div>

        <StatusPanel
          status={connStatus}
          progress={progress > 0 ? progress : undefined}
          speed={speed}
          label={connStatus === 'connecting' ? 'Waiting for sender...' : ''}
        />

        {senderStale && connStatus === 'connecting' && !peerLeft && (
          <div className="notice-error" style={{ marginTop: 12 }}>
            ✕ No sender found. The sender's tab may be closed — ask them to re-share the link.
          </div>
        )}

        {verified && (
          <div className="notice-success" style={{ marginTop: 12 }}>
            ✓ SHA-256 verified — download started automatically
          </div>
        )}

        {peerLeft && !verified && (
          <div className="notice-error" style={{ marginTop: 12 }}>
            ✕ Sender disconnected. If transfer was in progress, reconnecting will resume it.
          </div>
        )}

        {error && (
          <div className="notice-error" style={{ marginTop: 12 }}>
            ✕ {error}
          </div>
        )}

        {!verified && progress > 0 && (
          <div className="card" style={{ padding: 14, marginTop: 12 }}>
            <div className="mono" style={{ fontSize: 12, color: '#555' }}>
              Last verified chunk: #{lastChunkRef.current} · Chunks received: {chunksRef.current.size}
              {totalChunksRef.current && ` / ${totalChunksRef.current}`}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
