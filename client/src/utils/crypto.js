const ALGO = { name: 'AES-GCM', length: 256 }

export async function generateKey() {
  return crypto.subtle.generateKey(ALGO, true, ['encrypt', 'decrypt'])
}

export async function keyToBase64(key) {
  const raw = await crypto.subtle.exportKey('raw', key)
  return btoa(String.fromCharCode(...new Uint8Array(raw)))
}

export async function base64ToKey(b64) {
  const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  return crypto.subtle.importKey('raw', raw, ALGO, false, ['encrypt', 'decrypt'])
}

export async function encryptChunk(key, iv, data) {
  return crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)
}

export async function decryptChunk(key, iv, data) {
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
}

export async function sha256(buffer) {
  const hash = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function generateIV() {
  return crypto.getRandomValues(new Uint8Array(12))
}
