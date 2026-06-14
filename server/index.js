import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// roomId -> Set of socket ids
const rooms = new Map();

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('join-room', (roomId) => {
    currentRoom = roomId;
    socket.join(roomId);

    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    const existingCount = rooms.get(roomId).size;
    rooms.get(roomId).add(socket.id);

    // Tell existing members someone joined
    socket.to(roomId).emit('peer-joined');
    // Also tell the new joiner if someone was already here — handles late-joining sender
    if (existingCount > 0) socket.emit('peer-joined');
  });

  socket.on('offer', (roomId, offer) => {
    socket.to(roomId).emit('offer', offer);
  });

  socket.on('answer', (roomId, answer) => {
    socket.to(roomId).emit('answer', answer);
  });

  socket.on('ice-candidate', (roomId, candidate) => {
    socket.to(roomId).emit('ice-candidate', candidate);
  });

  // Relay resume request so sender knows where to restart from
  socket.on('resume-request', (roomId, chunkIndex) => {
    socket.to(roomId).emit('resume-request', chunkIndex);
  });

  socket.on('disconnect', () => {
    if (currentRoom) {
      const members = rooms.get(currentRoom);
      if (members) {
        members.delete(socket.id);
        if (members.size === 0) rooms.delete(currentRoom);
      }
      socket.to(currentRoom).emit('peer-left');
    }
  });
});

app.get('/health', (_, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => console.log(`Signaling server on :${PORT}`));
