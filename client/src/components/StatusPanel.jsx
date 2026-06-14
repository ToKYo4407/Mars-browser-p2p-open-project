export default function StatusPanel({ status, progress, speed, label }) {
  const dotClass = status === 'connected' ? 'connected'
    : status === 'connecting' ? 'connecting'
    : 'disconnected'

  return (
    <div className="card" style={{ padding: 20, marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span className={`status-dot ${dotClass}`} />
        <span style={{ fontWeight: 600, fontSize: 14, textTransform: 'uppercase', letterSpacing: 1 }}>
          {status}
        </span>
        {label && (
          <span className="mono" style={{ fontSize: 12, color: '#555', marginLeft: 'auto' }}>
            {label}
          </span>
        )}
      </div>

      {progress !== undefined && (
        <>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${Math.min(100, progress)}%` }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>
              {Math.round(progress)}%
            </span>
            {speed && (
              <span className="mono" style={{ fontSize: 13, color: '#555' }}>
                {speed}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
