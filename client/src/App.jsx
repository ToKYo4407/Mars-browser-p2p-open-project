import { useEffect, useState } from 'react'
import SenderPage from './pages/SenderPage.jsx'
import ReceiverPage from './pages/ReceiverPage.jsx'

function parseHash() {
  const hash = window.location.hash.slice(1)
  const params = new URLSearchParams(hash)
  return { roomId: params.get('room'), key: params.get('key') }
}

export default function App() {
  const [route, setRoute] = useState(null)

  useEffect(() => {
    const { roomId, key } = parseHash()
    setRoute(roomId && key ? 'receiver' : 'sender')

    const onChange = () => {
      const { roomId, key } = parseHash()
      setRoute(roomId && key ? 'receiver' : 'sender')
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  if (!route) return null

  return route === 'receiver' ? <ReceiverPage /> : <SenderPage />
}
