export const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
  ]
}

export const CHUNK_SIZE = 65536 // 64KB

export function createPeerConnection() {
  return new RTCPeerConnection(ICE_SERVERS)
}
