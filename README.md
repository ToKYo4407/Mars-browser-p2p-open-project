# Zawar Ishita Aashish — Mars Open Project

Zero-knowledge, encrypted, peer-to-peer file transfer in the browser.

## Quick Start

**Terminal 1 — signaling server:**
```bash
cd server && npm install && npm run dev
```

**Terminal 2 — frontend:**
```bash
cd client && npm install && npm run dev
```

Then open http://localhost:5173

## How it works

1. Sender drops a file → AES-GCM key generated in-browser
2. Share URL contains `#room=ID&key=BASE64_KEY` — key never hits the server
3. WebRTC DataChannel carries encrypted 64KB chunks directly peer-to-peer
4. Receiver decrypts each chunk, reassembles, SHA-256 verifies, auto-downloads
5. On disconnect mid-transfer: receiver emits `resume-request(lastChunk)`, sender resumes from there
