/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, RotateCcw, User, Info, Timer, Plus, Trash2, Play, Share2, Copy, Check } from 'lucide-react';
import confetti from 'canvas-confetti';
import { io, Socket } from 'socket.io-client';

// Types
type PlayerId = string; // Using socket ID
type LineType = 'h' | 'v';

interface Player {
  id: PlayerId;
  name: string;
  color: string;
  score: number;
}

// Constants
const PLAYER_COLORS = [
  '#3b82f6', // Blue
  '#ef4444', // Red
  '#10b981', // Green
  '#f59e0b', // Orange
  '#8b5cf6', // Purple
  '#ec4899', // Pink
];

const TURN_TIME = 20;

export default function App() {
  // Connection State
  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomId, setRoomId] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [copied, setCopied] = useState(false);

  // Setup State
  const [isSetup, setIsSetup] = useState(true);
  const [roomPlayers, setRoomPlayers] = useState<any[]>([]);

  // Game State
  const [players, setPlayers] = useState<Player[]>([]);
  const [gridSize, setGridSize] = useState(6);
  const [numBoxes, setNumBoxes] = useState(5);
  const [hLines, setHLines] = useState<PlayerId[][]>([]);
  const [vLines, setVLines] = useState<PlayerId[][]>([]);
  const [boxes, setBoxes] = useState<(PlayerId | null)[][]>([]);
  const [currentPlayerIndex, setCurrentPlayerIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(TURN_TIME);
  const [gameOver, setGameOver] = useState(false);
  const [winner, setWinner] = useState<Player | 'draw' | null>(null);

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize Socket
  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on('room-update', ({ players, started }) => {
      setRoomPlayers(players);
      if (started) setIsSetup(false);
    });

    newSocket.on('game-started', ({ players: startedPlayers, gameState }) => {
      const size = 4 + startedPlayers.length;
      const boxesCount = size - 1;
      
      const gamePlayers: Player[] = startedPlayers.map((p: any, index: number) => ({
        ...p,
        color: PLAYER_COLORS[index % PLAYER_COLORS.length],
        score: 0
      }));

      setPlayers(gamePlayers);
      setGridSize(size);
      setNumBoxes(boxesCount);
      setHLines(Array(size).fill(null).map(() => Array(boxesCount).fill('')));
      setVLines(Array(boxesCount).fill(null).map(() => Array(size).fill('')));
      setBoxes(Array(boxesCount).fill(null).map(() => Array(boxesCount).fill(null)));
      setCurrentPlayerIndex(0);
      setTimeLeft(TURN_TIME);
      setGameOver(false);
      setWinner(null);
      setIsSetup(false);
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  const joinRoom = () => {
    if (!roomId || !playerName) return;
    socket?.emit('join-room', { roomId, playerName });
    setIsJoined(true);
  };

  const createRoom = () => {
    const newId = Math.random().toString(36).substring(2, 8).toUpperCase();
    setRoomId(newId);
    setIsHost(true);
  };

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const startGame = () => {
    if (!isHost) return;
    socket?.emit('start-game', { roomId, config: { players: roomPlayers } });
  };

  const handleLineClick = (type: LineType, r: number, c: number) => {
    if (gameOver || isSetup || !socket) return;
    
    const currentPlayer = players[currentPlayerIndex];
    if (currentPlayer.id !== socket.id) return; // Not your turn

    if (type === 'h' && hLines[r][c] !== '') return;
    if (type === 'v' && vLines[r][c] !== '') return;

    socket.emit('make-move', { 
      roomId, 
      move: { type, r, c, playerId: socket.id } 
    });
  };

  // Move logic for local sync
  useEffect(() => {
    if (!socket) return;
    
    const onMoveMade = (move: any) => {
      setHLines(prevH => {
        const nextH = [...prevH.map(row => [...row])];
        if (move.type === 'h') nextH[move.r][move.c] = move.playerId;
        
        setVLines(prevV => {
          const nextV = [...prevV.map(row => [...row])];
          if (move.type === 'v') nextV[move.r][move.c] = move.playerId;
          
          // Check boxes
          let boxesCompleted = 0;
          const newBoxes = [...boxes.map(row => [...row])];
          
          const checkSingleBox = (row: number, col: number) => {
            if (row < 0 || row >= numBoxes || col < 0 || col >= numBoxes) return false;
            if (newBoxes[row][col] !== null) return false;
            const isComplete = nextH[row][col] !== '' && nextH[row + 1][col] !== '' && nextV[row][col] !== '' && nextV[row][col + 1] !== '';
            if (isComplete) {
              newBoxes[row][col] = move.playerId;
              boxesCompleted++;
              return true;
            }
            return false;
          };

          if (move.type === 'h') { checkSingleBox(move.r - 1, move.c); checkSingleBox(move.r, move.c); }
          else { checkSingleBox(move.r, move.c - 1); checkSingleBox(move.r, move.c); }

          if (boxesCompleted > 0) {
            setBoxes(newBoxes);
            setPlayers(prev => prev.map(p => p.id === move.playerId ? { ...p, score: p.score + boxesCompleted } : p));
          } else {
            setCurrentPlayerIndex(prev => (prev + 1) % players.length);
          }
          setTimeLeft(TURN_TIME);
          return nextV;
        });
        return nextH;
      });
    };

    socket.on('move-made', onMoveMade);
    return () => { socket.off('move-made', onMoveMade); };
  }, [socket, players, numBoxes, boxes]);

  // Timer Effect
  useEffect(() => {
    if (isSetup || gameOver || !isHost) return;

    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          // Host triggers random move for current player
          const availableHLines: any[] = [];
          const availableVLines: any[] = [];
          hLines.forEach((row, r) => row.forEach((owner, c) => { if (owner === '') availableHLines.push({ r, c }); }));
          vLines.forEach((row, r) => row.forEach((owner, c) => { if (owner === '') availableVLines.push({ r, c }); }));
          const total = availableHLines.length + availableVLines.length;
          if (total > 0) {
            const idx = Math.floor(Math.random() * total);
            const move = idx < availableHLines.length ? { type: 'h', ...availableHLines[idx] } : { type: 'v', ...availableVLines[idx - availableHLines.length] };
            socket?.emit('make-move', { roomId, move: { ...move, playerId: players[currentPlayerIndex].id } });
          }
          return TURN_TIME;
        }
        return prev - 1;
      });
    }, 1000);

    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [currentPlayerIndex, isSetup, gameOver, isHost, hLines, vLines, players, socket, roomId]);

  // Check for game over
  useEffect(() => {
    if (isSetup) return;
    const totalBoxes = numBoxes * numBoxes;
    const currentTotalScore = players.reduce((sum, p) => sum + p.score, 0);
    
    if (currentTotalScore === totalBoxes && totalBoxes > 0) {
      setGameOver(true);
      const maxScore = Math.max(...players.map(p => p.score));
      const winners = players.filter(p => p.score === maxScore);
      if (winners.length === 1) {
        setWinner(winners[0]);
        confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 }, colors: [winners[0].color] });
      } else {
        setWinner('draw');
      }
    }
  }, [players, numBoxes, isSetup]);

  if (!isJoined) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-zinc-50 font-sans">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white p-8 rounded-3xl shadow-2xl border border-zinc-100 w-full max-w-md">
          <h1 className="text-4xl font-display font-black text-center mb-8 text-zinc-900">DOTS <span className="text-blue-500">&</span> BOXES</h1>
          <div className="space-y-6">
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Seu Nome</label>
              <input type="text" value={playerName} onChange={(e) => setPlayerName(e.target.value)} className="w-full px-4 py-3 rounded-2xl border border-zinc-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all" placeholder="Ex: João" />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">ID da Sala</label>
              <div className="flex gap-2">
                <input type="text" value={roomId} onChange={(e) => setRoomId(e.target.value.toUpperCase())} className="flex-1 px-4 py-3 rounded-2xl border border-zinc-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all uppercase" placeholder="ABCDEF" />
                <button onClick={createRoom} className="p-3 bg-zinc-100 text-zinc-600 rounded-2xl hover:bg-zinc-200 transition-all"><Plus size={24} /></button>
              </div>
            </div>
            <button onClick={joinRoom} disabled={!roomId || !playerName} className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-200">Entrar na Sala</button>
          </div>
        </motion.div>
      </div>
    );
  }

  if (isSetup) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-zinc-50 font-sans">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-white p-8 rounded-3xl shadow-2xl border border-zinc-100 w-full max-w-md">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-2xl font-display font-black text-zinc-900">Sala: <span className="text-blue-500">{roomId}</span></h2>
            <button onClick={copyRoomId} className="p-2 bg-zinc-100 text-zinc-600 rounded-xl hover:bg-zinc-200 transition-all">{copied ? <Check size={20} className="text-green-500" /> : <Copy size={20} />}</button>
          </div>
          <div className="space-y-3 mb-8">
            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Jogadores Conectados ({roomPlayers.length})</label>
            {roomPlayers.map((p, i) => (
              <div key={p.id} className="flex items-center gap-3 p-3 bg-zinc-50 rounded-2xl border border-zinc-100">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold" style={{ backgroundColor: PLAYER_COLORS[i % PLAYER_COLORS.length] }}>{i + 1}</div>
                <span className="font-bold text-zinc-700">{p.name} {p.id === socket?.id && '(Você)'}</span>
              </div>
            ))}
          </div>
          {isHost ? (
            <button onClick={startGame} disabled={roomPlayers.length < 2} className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 transition-all disabled:opacity-50 shadow-lg shadow-blue-200 flex items-center justify-center gap-2"><Play size={20} /> Começar Jogo</button>
          ) : (
            <div className="text-center p-4 bg-blue-50 text-blue-600 rounded-2xl font-bold animate-pulse">Aguardando o host iniciar...</div>
          )}
        </motion.div>
      </div>
    );
  }

  const currentPlayer = players[currentPlayerIndex];
  const isMyTurn = currentPlayer?.id === socket?.id;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-zinc-50 font-sans">
      <div className="flex flex-wrap justify-center gap-3 w-full max-w-2xl mb-6">
        {players.map((p, idx) => (
          <motion.div key={p.id} animate={{ scale: currentPlayerIndex === idx ? 1.05 : 1, opacity: currentPlayerIndex === idx ? 1 : 0.6, borderColor: currentPlayerIndex === idx ? p.color : '#e4e4e7' }} className="p-3 rounded-2xl border-2 bg-white min-w-[100px] transition-all">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 truncate max-w-[60px]">{p.name}</span>
            </div>
            <div className="text-xl font-display font-black" style={{ color: p.color }}>{p.score}</div>
          </motion.div>
        ))}
      </div>
      <div className="w-full max-w-md h-1.5 bg-zinc-200 rounded-full mb-6 overflow-hidden">
        <motion.div initial={{ width: '100%' }} animate={{ width: `${(timeLeft / TURN_TIME) * 100}%` }} transition={{ duration: 1, ease: 'linear' }} className="h-full" style={{ backgroundColor: currentPlayer?.color }} />
      </div>
      <div className="relative p-4 bg-white rounded-3xl shadow-xl border border-zinc-100 overflow-auto max-w-full">
        <div className="grid gap-0 mx-auto" style={{ gridTemplateColumns: `repeat(${numBoxes}, 45px)`, gridTemplateRows: `repeat(${numBoxes}, 45px)` }}>
          {Array(numBoxes).fill(null).map((_, r) => Array(numBoxes).fill(null).map((_, c) => (
            <div key={`box-${r}-${c}`} className="relative w-[45px] h-[45px]">
              <AnimatePresence>{boxes[r][c] && <motion.div initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 0.2 }} className="absolute inset-1 rounded-sm" style={{ backgroundColor: players.find(p => p.id === boxes[r][c])?.color }} />}</AnimatePresence>
              <div className="absolute -top-1 -left-1 w-1.5 h-1.5 rounded-full bg-zinc-300 z-30" />
              <button onClick={() => handleLineClick('h', r, c)} className={`absolute -top-1 left-1 h-1.5 transition-all z-20 rounded-full ${hLines[r][c] !== '' ? 'w-[43px]' : 'w-[43px] bg-transparent hover:bg-zinc-100 cursor-pointer'}`} style={{ backgroundColor: hLines[r][c] !== '' ? players.find(p => p.id === hLines[r][c])?.color : undefined }} />
              <button onClick={() => handleLineClick('v', r, c)} className={`absolute top-1 -left-1 w-1.5 transition-all z-20 rounded-full ${vLines[r][c] !== '' ? 'h-[43px]' : 'h-[43px] bg-transparent hover:bg-zinc-100 cursor-pointer'}`} style={{ backgroundColor: vLines[r][c] !== '' ? players.find(p => p.id === vLines[r][c])?.color : undefined }} />
              {r === numBoxes - 1 && c === numBoxes - 1 && <div className="absolute -bottom-1 -right-1 w-1.5 h-1.5 rounded-full bg-zinc-300 z-30" />}
              {r === numBoxes - 1 && (<><button onClick={() => handleLineClick('h', r + 1, c)} className={`absolute -bottom-1 left-1 h-1.5 transition-all z-20 rounded-full ${hLines[r + 1][c] !== '' ? 'w-[43px]' : 'w-[43px] bg-transparent hover:bg-zinc-100 cursor-pointer'}`} style={{ backgroundColor: hLines[r + 1][c] !== '' ? players.find(p => p.id === hLines[r + 1][c])?.color : undefined }} /><div className="absolute -bottom-1 -left-1 w-1.5 h-1.5 rounded-full bg-zinc-300 z-30" /></>)}
              {c === numBoxes - 1 && (<><button onClick={() => handleLineClick('v', r, c + 1)} className={`absolute top-1 -right-1 w-1.5 transition-all z-20 rounded-full ${vLines[r][c + 1] !== '' ? 'h-[43px]' : 'h-[43px] bg-transparent hover:bg-zinc-100 cursor-pointer'}`} style={{ backgroundColor: vLines[r][c + 1] !== '' ? players.find(p => p.id === vLines[r][c + 1])?.color : undefined }} /><div className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-zinc-300 z-30" /></>)}
            </div>
          )))}
        </div>
      </div>
      <div className="mt-8 flex flex-col items-center gap-4">
        <div className="flex items-center gap-4">
          <button onClick={() => window.location.reload()} className="flex items-center gap-2 px-6 py-3 bg-zinc-900 text-white rounded-2xl font-bold hover:bg-zinc-800 transition-all active:scale-95"><RotateCcw size={18} /> Sair</button>
          <div className="flex items-center gap-2 px-4 py-3 bg-white border border-zinc-200 text-zinc-600 rounded-2xl font-bold shadow-sm"><Timer size={18} style={{ color: currentPlayer?.color }} /><span className="tabular-nums">{timeLeft}s</span></div>
        </div>
        <div className={`px-6 py-2 rounded-full font-bold text-sm transition-all ${isMyTurn ? 'ring-2 ring-offset-2' : ''}`} style={{ backgroundColor: `${currentPlayer?.color}15`, color: currentPlayer?.color, ringColor: currentPlayer?.color }}>{isMyTurn ? 'Sua Vez!' : `Vez de: ${currentPlayer?.name}`}</div>
      </div>
      <AnimatePresence>{gameOver && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/60 backdrop-blur-sm">
          <motion.div initial={{ scale: 0.9, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} className="bg-white rounded-3xl p-8 max-w-md w-full text-center shadow-2xl">
            <div className="w-16 h-16 bg-yellow-100 text-yellow-600 rounded-full flex items-center justify-center mx-auto mb-6"><Trophy size={32} /></div>
            <h2 className="text-2xl font-display font-black text-zinc-900 mb-2">{winner === 'draw' ? 'Empate!' : `${winner?.name} Venceu!`}</h2>
            <p className="text-zinc-500 mb-6 font-medium">Parabéns pela partida!</p>
            <div className="grid grid-cols-2 gap-2 mb-6 max-h-[150px] overflow-auto p-1">
              {players.sort((a, b) => b.score - a.score).map(p => (
                <div key={p.id} className="p-2 rounded-xl border border-zinc-100 flex flex-col items-center">
                  <div className="text-[8px] font-bold text-zinc-400 uppercase tracking-wider mb-1 truncate w-full">{p.name}</div>
                  <div className="text-lg font-display font-black" style={{ color: p.color }}>{p.score}</div>
                </div>
              ))}
            </div>
            <button onClick={() => window.location.reload()} className="w-full py-4 bg-zinc-900 text-white rounded-2xl font-bold hover:bg-zinc-800 transition-all active:scale-95">Voltar ao Menu</button>
          </motion.div>
        </motion.div>
      )}</AnimatePresence>
    </div>
  );
}

