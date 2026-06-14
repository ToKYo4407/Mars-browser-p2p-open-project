import { useState, useRef } from 'react'

const MAX_SIZE = 50 * 1024 * 1024 // 50MB

export default function DropZone({ onFile }) {
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef()

  function handleFile(file) {
    setError('')
    if (!file) return
    if (file.size > MAX_SIZE) {
      setError('File too large. Max size is 50MB.')
      return
    }
    onFile(file)
  }

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    handleFile(e.dataTransfer.files[0])
  }

  return (
    <div>
      <div
        className={`drop-zone${dragging ? ' drag-over' : ''}`}
        style={{ padding: '60px 40px', textAlign: 'center' }}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current.click()}
      >
        <div style={{ fontSize: 48, marginBottom: 16 }}>⬆</div>
        <p style={{ fontWeight: 700, fontSize: 20, marginBottom: 8 }}>
          Drop file here or click to select
        </p>
        <p style={{ color: '#555', fontSize: 14 }} className="mono">
          Max 50MB · Encrypted in-browser
        </p>
        <input
          ref={inputRef}
          type="file"
          style={{ display: 'none' }}
          onChange={e => handleFile(e.target.files[0])}
        />
      </div>
      {error && (
        <div className="notice-error" style={{ marginTop: 12 }}>{error}</div>
      )}
    </div>
  )
}
