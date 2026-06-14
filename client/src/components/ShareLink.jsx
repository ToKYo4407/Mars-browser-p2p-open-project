import { useState } from 'react'

export default function ShareLink({ url }) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="card" style={{ padding: 20, marginTop: 16 }}>
      <div style={{ marginBottom: 10, fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>
        Share Link
      </div>
      <div style={{
        display: 'flex',
        gap: 8,
        alignItems: 'stretch',
        flexWrap: 'wrap'
      }}>
        <div
          className="mono"
          style={{
            flex: 1,
            border: '2px solid #0A0A0A',
            padding: '10px 12px',
            fontSize: 12,
            wordBreak: 'break-all',
            background: '#f5f5f0',
            minWidth: 0,
            lineHeight: 1.5
          }}
        >
          {url}
        </div>
        <button className={`btn${copied ? ' btn-yellow' : ''}`} onClick={copy} style={{ flexShrink: 0 }}>
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <p style={{ marginTop: 10, fontSize: 12, color: '#555' }}>
        🔒 Decryption key is in the URL hash — never sent to the server.
      </p>
    </div>
  )
}
