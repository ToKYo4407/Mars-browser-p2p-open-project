# Zawar Ishita Aashish — Mars Open Project

Zero-knowledge, peer-to-peer, encrypted file transfer in the browser. No uploads to a server. No accounts. No file size limits beyond available RAM.

---

## Live deployment

| | URL |
|---|---|
| Frontend | https://mars-browser-p2p-open-project.vercel.app |
| Signaling server | https://mars-browser-p2p-open-project-production.up.railway.app |

---

## Features delivered

**Core requirements**

| Feature | Implementation |
|---|---|
| Share Room Creation | Drag-and-drop zone generates a UUID room ID and a unique share link per file |
| Signaling Handshake | Node.js + Socket.io server relays offer, answer, and ICE candidates |
| Direct P2P Transfer | WebRTC DataChannel carries 64 KB chunks directly between browsers |
| Chunk Verification | SHA-256 of the full plaintext computed on both sides and compared before download |
| Progress and Status | Real-time percentage bar, MB/s transfer speed, and CONNECTING / CONNECTED / DISCONNECTED status |
| Graceful Disconnect | `peer-left` event surfaces a UI notice on both sides without crashing |
| Auto-Download | Chunks reassembled in memory, Blob created, download triggered automatically |

**Brownie extensions**

| Extension | Implementation |
|---|---|
| Zero-Knowledge Encryption | AES-GCM 256-bit key generated in-browser, unique 12-byte IV per chunk, key passed only in the URL hash fragment — never touches the server or any HTTP request |
| Connection Churn Recovery | Receiver tracks the last contiguous verified chunk index, emits `resume-request` on disconnect, sender re-sends from that index |

---

## What it does

The sender drops a file. The browser generates an AES-GCM 256-bit encryption key locally, encrypts the file in 64 KB chunks, and produces a share URL. The decryption key lives only in the URL fragment (the `#...` part), which browsers never include in HTTP requests. The receiver opens the URL, the key is extracted in-browser, the two peers connect directly via WebRTC, and the file transfers encrypted chunk by chunk. On arrival, each chunk is decrypted and the reassembled file is SHA-256 verified against the sender's hash before the download is triggered.

The signaling server only brokers the WebRTC handshake (offer, answer, ICE candidates). It never sees the file, the key, or any file content.

---

## Architecture

```
Sender browser                 Signaling server              Receiver browser
     |                              |                               |
     |-- join-room(roomId) -------->|                               |
     |                              |<-- join-room(roomId) ---------|
     |<-- peer-joined --------------|                               |
     |-- offer(SDP) -------------->|-- offer(SDP) --------------->|
     |<-- answer(SDP) -------------|<-- answer(SDP) ---------------|
     |-- ice-candidate ----------->|-- ice-candidate ------------>|
     |<-- ice-candidate -----------|<-- ice-candidate -------------|
     |                                                             |
     |<=================== WebRTC DataChannel ===================>|
     |              (encrypted chunks, direct P2P)                 |
```

The signaling server is a thin Socket.io relay. Once the DataChannel opens, it is no longer involved.

---

## Security model

- The AES-GCM key is generated with `crypto.subtle.generateKey` inside the sender's browser and never transmitted over the network. It appears only in the URL fragment, which is not sent in HTTP requests and is not logged by servers or proxies.
- Each 64 KB chunk is encrypted with a fresh 12-byte random IV. The wire format per chunk is: `[4-byte chunk index (big-endian)] [12-byte IV] [AES-GCM ciphertext]`.
- After all chunks arrive, the receiver decrypts the plaintext, hashes it with SHA-256, and compares it to the hash the sender included in the done signal. A mismatch surfaces as an error and no download is triggered.
- If the WebRTC connection drops mid-transfer, the receiver emits a `resume-request` with the index of the last contiguous chunk it verified. The sender re-sends from the next chunk. The encryption key is held in memory for the lifetime of the receiver tab.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, plain CSS (neo-brutalist) |
| Crypto | Web Crypto API — AES-GCM 256, SHA-256 |
| P2P transport | WebRTC DataChannel |
| Signaling | Node.js, Express, Socket.io |
| ICE | Google STUN (`stun.l.google.com:19302`) |
| Tests | Node.js built-in test runner (signaling unit), Playwright (E2E) |

---

## Running locally

You need Node.js 18 or later.

**Terminal 1 — signaling server:**
```
cd server
npm install
npm run dev
```

**Terminal 2 — frontend:**
```
cd client
npm install
npm run dev
```

Open `http://localhost:5173` in two browser tabs or two different browsers. Drop a file in one tab, copy the share link, open it in the other tab.

Alternatively, `make dev` runs both concurrently (Ctrl-C stops both).

---

## Makefile targets

| Target | What it does |
|---|---|
| `make install` | Installs dependencies for server, client, and tests |
| `make dev` | Starts server and frontend in parallel |
| `make build` | Builds the frontend with Vite |
| `make test-signaling` | Runs Node.js unit tests for the signaling server |
| `make test-e2e` | Builds, then runs Playwright browser-to-browser tests |
| `make test` | Runs all tests |

---

## Tests

**Signaling unit tests** (`tests/signaling.test.js`) — Node.js built-in test runner, no browser required. Verifies: room join/leave, offer/answer relay, ICE candidate relay, peer-left notification, that file payloads are never emitted by the server (zero-knowledge property checked via a Socket.io middleware spy).

**E2E tests** (`tests/e2e/`) — Playwright with two Chromium browser contexts on the same machine. Covers:
- Full browser-to-browser transfer with SHA-256 verification of the downloaded bytes
- Key-in-hash-only: confirms the key fragment is absent from all network requests
- Graceful disconnect: confirms the UI shows the correct state when a peer leaves

---

## Project structure

```
client/
  src/
    pages/
      SenderPage.jsx       file drop, encryption, offer creation, chunk sending
      ReceiverPage.jsx     offer handling, decryption, reassembly, download
    components/
      DropZone.jsx
      ShareLink.jsx
      StatusPanel.jsx
    utils/
      crypto.js            AES-GCM keygen, encrypt, decrypt, SHA-256, IV generation
      webrtc.js            RTCPeerConnection factory, ICE config, chunk size constant
    index.css              neo-brutalist design tokens and component styles

server/
  index.js                 Express + Socket.io signaling relay

tests/
  signaling.test.js        Node.js unit tests
  e2e/
    transfer.spec.js
    security.spec.js
    disconnect.spec.js
```
