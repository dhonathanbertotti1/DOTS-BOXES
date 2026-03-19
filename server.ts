import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import path from 'path';

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = process.env.PORT || 3000;

  // Game Rooms State
  const rooms = new Map<string, {
    players: { id: string, name: string }[],
    started: boolean,
    gameState?: any
  }>();

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join-room', ({ roomId, playerName }) => {
      socket.join(roomId);
      
      if (!rooms.has(roomId)) {
        rooms.set(roomId, { players: [], started: false });
      }

      const room = rooms.get(roomId)!;
      if (room.started) {
        socket.emit('error', 'Game already started');
        return;
      }

      room.players.push({ id: socket.id, name: playerName });
      io.to(roomId).emit('room-update', { 
        players: room.players,
        started: room.started
      });
    });

    socket.on('start-game', ({ roomId }) => {
      const room = rooms.get(roomId);
      if (room && !room.started) {
        room.started = true;
        io.to(roomId).emit('game-started', { 
          players: room.players 
        });
      }
    });

    socket.on('make-move', ({ roomId, move }) => {
      // Broadcast move to everyone in the room
      io.to(roomId).emit('move-made', move);
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
      rooms.forEach((room, roomId) => {
        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex !== -1) {
          room.players.splice(playerIndex, 1);
          if (room.players.length === 0) {
            rooms.delete(roomId);
          } else {
            io.to(roomId).emit('room-update', { 
              players: room.players,
              started: room.started
            });
          }
        }
      });
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
