import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import confetti from 'canvas-confetti';
import { motion, AnimatePresence } from 'motion/react';
import { CardComponent } from './components/Card';
import { ChipStack } from './components/Chips';
import {
  ActionAvailability,
  BIG_BLIND,
  Card,
  configLabel,
  DEFAULT_ROOM_CONFIG,
  EnterRoomResponse,
  GameActionPayload,
  RANKS,
  RoomConfig,
  RoomPreset,
  RoomSnapshot,
} from './types';
import { Bot, DoorOpen, Play, Settings, User, Users } from 'lucide-react';

const STORAGE_KEY = 'holdem.playerToken';
const EMPTY_ACTIONS: ActionAvailability = {
  check: false,
  call: false,
  raise: false,
  fold: false,
  toCall: 0,
  minRaiseTo: null,
  maxRaiseTo: null,
};

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting';

export default function App() {
  const socketRef = useRef<Socket | null>(null);
  const lastCelebratedHand = useRef<number | null>(null);

  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; tone: 'error' | 'success' } | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [joining, setJoining] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<RoomConfig>(DEFAULT_ROOM_CONFIG);
  const [settingsBaseline, setSettingsBaseline] = useState<RoomConfig>(DEFAULT_ROOM_CONFIG);
  const [betAmount, setBetAmount] = useState(BIG_BLIND);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const syncViewport = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };

    syncViewport();
    window.addEventListener('resize', syncViewport);
    return () => window.removeEventListener('resize', syncViewport);
  }, []);

  useEffect(() => {
    const token = window.localStorage.getItem(STORAGE_KEY);
    if (!token) return;

    setConnectionState('reconnecting');
    void reconnect(token);
  }, []);

  useEffect(() => {
    if (!room) return;
    const nextConfig = cloneConfig(room.nextConfig ?? room.config);
    if (!settingsOpen) {
      setSettingsDraft(nextConfig);
      setSettingsBaseline(nextConfig);
    }
  }, [room, settingsOpen]);

  useEffect(() => {
    const showdown = room?.game?.showdown;
    if (!showdown || !room) return;
    if (lastCelebratedHand.current === room.handNo) return;
    if (showdown.winnerIds.includes(room.selfId)) {
      confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 } });
    }
    lastCelebratedHand.current = room.handNo;
  }, [room]);

  const isMobile = viewport.width < 768;
  const isShortViewport = viewport.height > 0 && viewport.height < 520;
  const isCompactLayout = isMobile || isShortViewport;
  const isUltraCompact = viewport.height > 0 && viewport.height < 430;
  const isLandscapePhone = isMobile && viewport.width > viewport.height;
  const tableTilt = isCompactLayout ? 26 : 35;
  const tableScale = isUltraCompact ? 0.78 : isCompactLayout ? 0.9 : 1.04;

  const self = room?.players.find((player) => player.id === room.selfId) ?? null;
  const isHost = Boolean(room && room.hostId === room.selfId);
  const actions = room?.game?.availableActions ?? EMPTY_ACTIONS;
  const totalPot = room ? (room.game?.pot ?? 0) + room.players.reduce((sum, player) => sum + player.bet, 0) : 0;
  const displaySeats = useMemo(() => mapDisplaySeats(room, self?.seat ?? 0), [room, self?.seat]);
  const hostCanEditSeats = Boolean(isHost && (!room?.game || room.game.phase === 'showdown'));
  const isHandInProgress = Boolean(room?.game && room.game.phase !== 'showdown');
  const settingsDirty = !areRoomConfigsEqual(settingsDraft, settingsBaseline);
  const invalidPlayerCountDuringHand = isHandInProgress && settingsDraft.maxPlayers > room.playerCount;
  const canSaveSettings = settingsDirty && !invalidPlayerCountDuringHand;
  const maxRaiseTo = actions.maxRaiseTo ?? 0;
  const minRaiseTo = actions.minRaiseTo ?? 0;

  useEffect(() => {
    if (!actions.raise || !maxRaiseTo) {
      setBetAmount(minRaiseTo || BIG_BLIND);
      return;
    }
    setBetAmount((current) => {
      if (current < minRaiseTo) return minRaiseTo;
      if (current > maxRaiseTo) return maxRaiseTo;
      return current;
    });
  }, [actions.raise, maxRaiseTo, minRaiseTo]);

  const gameTitle = useMemo(() => getGameMessage(room), [room]);

  const onEnterRoom = async (event: React.FormEvent) => {
    event.preventDefault();
    if (joining) return;

    const trimmedName = name.trim();
    const normalizedRoomCode = roomCode.replace(/\D/g, '').slice(0, 6);
    if (!trimmedName) {
      showError('Please enter your name.');
      return;
    }
    if (!/^\d{6}$/.test(normalizedRoomCode)) {
      showError('Room code must be 6 digits.');
      return;
    }

    setJoining(true);
    try {
      const response = await fetch('/api/rooms/enter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName, roomCode: normalizedRoomCode }),
      });
      const payload = (await response.json()) as EnterRoomResponse | { message?: string };
      if (!response.ok) {
        throw new Error(readErrorMessage(payload, 'Unable to enter room.'));
      }

      const roomResponse = payload as EnterRoomResponse;
      window.localStorage.setItem(STORAGE_KEY, roomResponse.playerToken);
      setRoom(roomResponse.roomSnapshot);
      connectSocket(roomResponse.playerToken);
      setConnectionState('connecting');
      setRoomCode(normalizedRoomCode);
    } catch (reason) {
      showError(toMessage(reason));
    } finally {
      setJoining(false);
    }
  };

  const reconnect = async (token: string) => {
    try {
      const response = await fetch('/api/rooms/reconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerToken: token }),
      });
      const payload = (await response.json()) as EnterRoomResponse | { message?: string };
      if (!response.ok) {
        throw new Error(readErrorMessage(payload, 'Unable to reconnect.'));
      }

      const roomResponse = payload as EnterRoomResponse;
      setRoom(roomResponse.roomSnapshot);
      setName(roomResponse.roomSnapshot.players.find((player) => player.id === roomResponse.roomSnapshot.selfId)?.name ?? '');
      setRoomCode(roomResponse.roomSnapshot.code);
      connectSocket(token);
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
      setConnectionState('idle');
    }
  };

  const connectSocket = (playerToken: string) => {
    socketRef.current?.disconnect();

    const socket = io({
      autoConnect: false,
      transports: ['websocket'],
    });

    socket.on('connect', () => {
      setConnectionState('connected');
      socket.emit('room:subscribe', { playerToken });
    });

    socket.on('disconnect', () => {
      setConnectionState((current) => (room ? 'reconnecting' : current));
    });

    socket.on('room:snapshot', (snapshot: RoomSnapshot) => {
      setRoom(snapshot);
      setConnectionState('connected');
    });

    socket.on('room:error', (payload: { message?: string }) => {
      showNotice(payload.message ?? 'Room error.', 'error');
    });

    socket.on('game:showdown', () => {
      setConnectionState('connected');
    });

    socket.connect();
    socketRef.current = socket;
  };

  const leaveRoom = () => {
    socketRef.current?.emit('room:leave');
    socketRef.current?.disconnect();
    socketRef.current = null;
    window.localStorage.removeItem(STORAGE_KEY);
    setRoom(null);
    setSettingsOpen(false);
    setConnectionState('idle');
  };

  const openSettings = () => {
    if (!room) return;
    const currentConfig = cloneConfig(room.nextConfig ?? room.config);
    setSettingsBaseline(currentConfig);
    setSettingsDraft(currentConfig);
    setSettingsOpen(true);
  };

  const applySettingsUpdate = (updater: (current: RoomConfig) => RoomConfig) => {
    setSettingsDraft((current) => {
      const nextConfig = { ...updater(current), fillBots: false };
      if (!(isHandInProgress && nextConfig.maxPlayers > (room?.playerCount ?? 0))) {
        socketRef.current?.emit('room:update-config', { config: nextConfig });
      }
      return nextConfig;
    });
  };

  const updatePreset = (preset: RoomPreset) => {
    applySettingsUpdate((current) => ({
      ...current,
      preset,
      removedRanks:
        preset === 'standard'
          ? []
          : preset === 'short'
            ? ['2', '3', '4', '5']
            : current.removedRanks.length > 0
              ? current.removedRanks
              : ['2', '3', '4', '5'],
    }));
  };

  const toggleRemovedRank = (rank: (typeof RANKS)[number]) => {
    applySettingsUpdate((current) => {
      const selected = new Set(current.removedRanks);
      if (selected.has(rank)) {
        selected.delete(rank);
      } else {
        selected.add(rank);
      }
      return {
        ...current,
        preset: 'custom',
        removedRanks: RANKS.filter((entry) => selected.has(entry)),
      };
    });
  };

  const sendAction = (payload: GameActionPayload) => {
    socketRef.current?.emit('game:action', payload);
  };

  const addBotAtSeat = (seat: number) => {
    if (!hostCanEditSeats) return;
    socketRef.current?.emit('room:add-bot', { seat });
  };

  const saveSettings = () => {
    if (room?.game && room.game.phase !== 'showdown' && settingsDraft.maxPlayers > room.playerCount) {
      showError('当前牌局进行中时，最大人数不能大于当前已在桌上的人数。');
      return;
    }
    const committed = cloneConfig(settingsDraft);
    setSettingsBaseline(committed);
    setSettingsDraft(committed);
    showNotice('设置已保存', 'success');
  };

  const cancelSettings = () => {
    const reverted = cloneConfig(settingsBaseline);
    socketRef.current?.emit('room:update-config', { config: reverted });
    setSettingsDraft(reverted);
  };

  const renderLobby = () => (
    <div className="min-h-[100dvh] overflow-auto bg-[radial-gradient(circle_at_top,_rgba(52,211,153,0.18),_transparent_35%),linear-gradient(180deg,#07111f,#030712)] px-5 py-6 text-white">
      <div className={`mx-auto rounded-[32px] border border-white/10 bg-slate-900/85 shadow-[0_25px_80px_rgba(0,0,0,0.5)] backdrop-blur-xl ${isLandscapePhone ? 'grid max-w-5xl grid-cols-[1.1fr_0.9fr] gap-0 overflow-hidden' : 'max-w-md p-7'}`}>
        <div className={isLandscapePhone ? 'flex flex-col justify-between border-b-0 border-r border-white/10 p-7' : ''}>
          <div className={isLandscapePhone ? 'mb-0' : 'mb-8'}>
            <div className="text-xs uppercase tracking-[0.35em] text-emerald-300/80">Texas Hold&apos;em</div>
            <h1 className={`mt-3 font-black tracking-tight ${isLandscapePhone ? 'text-3xl' : 'text-4xl'}`}>Room Entry</h1>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Enter a name and a 6-digit room code. If the room does not exist yet, it will be created automatically and you become the host.
            </p>
          </div>
        </div>

        <div className={isLandscapePhone ? 'p-7' : ''}>
          <form className="space-y-4" onSubmit={onEnterRoom}>
            <label className="block">
              <span className="mb-2 block text-xs uppercase tracking-[0.25em] text-slate-400">Name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value.slice(0, 18))}
                className="h-13 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 text-base outline-none transition focus:border-emerald-400"
                placeholder="Your nickname"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs uppercase tracking-[0.25em] text-slate-400">Room Code</span>
              <input
                value={roomCode}
                onChange={(event) => setRoomCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                className="h-13 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 text-base outline-none transition focus:border-emerald-400"
                placeholder="6 digits"
                inputMode="numeric"
              />
            </label>
            <button
              type="submit"
              disabled={joining}
              className="flex h-14 w-full items-center justify-center gap-3 rounded-2xl bg-emerald-400 font-bold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              <DoorOpen size={18} />
              {joining ? 'Entering...' : 'Enter Room'}
            </button>
          </form>

          {isLandscapePhone && (
            <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-6 text-slate-300">
              Horizontal mobile is supported here as well. The lobby and host settings now reflow instead of assuming portrait mode.
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (!room || !self) {
    return (
      <>
        {renderLobby()}
        <Toast message={notice?.message ?? error ?? null} tone={notice?.tone ?? 'error'} />
      </>
    );
  }

  return (
    <div className="h-[100dvh] overflow-hidden bg-slate-900 text-white font-sans relative">
      <div className="pointer-events-none fixed inset-0 -z-10 opacity-30">
        <div className="absolute left-[-10%] top-[-10%] h-[40%] w-[40%] rounded-full bg-emerald-500 blur-[150px]" />
        <div className="absolute bottom-[-10%] right-[-10%] h-[40%] w-[40%] rounded-full bg-cyan-500 blur-[150px]" />
      </div>

      <div className="absolute left-3 right-3 top-3 z-[60] mx-auto flex max-w-6xl items-start justify-between gap-2">
        <div className="min-w-0 rounded-full border border-white/10 bg-slate-950/78 px-3 py-2 text-[11px] text-slate-200 shadow-2xl backdrop-blur-xl">
          <div className="truncate font-medium">
            <span className="font-black tracking-[0.18em] text-white">{room.code}</span>
            <span className="mx-2 text-slate-500">|</span>
            <span>{room.humanCount}H</span>
            <span className="mx-1 text-slate-500">/</span>
            <span>{room.playerCount}/{room.maxPlayers}</span>
            <span className="mx-2 text-slate-500">|</span>
            <span>{configLabel(room.config)}</span>
            {room.nextConfig && (
              <>
                <span className="mx-2 text-slate-500">|</span>
                <span className="text-amber-200">Next {configLabel(room.nextConfig)}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-slate-950/78 px-2 py-1.5 shadow-2xl backdrop-blur-xl">
          <div className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
            connectionState === 'connected' ? 'bg-emerald-400/15 text-emerald-200' : 'bg-amber-400/15 text-amber-200'
          }`}>
            {connectionState === 'connected' ? 'On' : 'Sync'}
          </div>
          {isHost && (
            <button
              onClick={openSettings}
              className="grid h-8 w-8 place-items-center rounded-full bg-white/5 text-white transition hover:bg-white/10"
            >
              <Settings size={14} />
            </button>
          )}
          <button
            onClick={leaveRoom}
            className="grid h-8 w-8 place-items-center rounded-full bg-white/5 text-white transition hover:bg-white/10"
          >
            <DoorOpen size={14} />
          </button>
        </div>
      </div>

      <main className={`relative flex h-full items-center justify-center overflow-hidden perspective-[1500px] ${isCompactLayout ? 'px-1 py-1 sm:px-2' : 'p-2 sm:p-8'}`}>
        <div
          className="relative flex aspect-[16/9] max-h-full w-full max-w-5xl items-center justify-center transition-transform duration-700"
          style={{
            transform: `translateY(-5%) rotateX(${tableTilt}deg) scale(${tableScale})`,
            transformStyle: 'preserve-3d',
          }}
        >
          <div className={`pointer-events-none absolute inset-0 rounded-[200px] border-amber-900 bg-emerald-800 shadow-[0_50px_100px_rgba(0,0,0,0.6),inset_0_0_50px_rgba(0,0,0,0.3)] ${isCompactLayout ? 'rounded-[140px] border-[8px]' : 'border-[12px]'}`} />
          <div className={`pointer-events-none absolute border-2 border-emerald-700/50 ${isCompactLayout ? 'inset-3 rounded-[126px]' : 'inset-4 rounded-[180px]'}`} />

          <div
            className={`pointer-events-none absolute z-0 flex items-center justify-center overflow-hidden select-none ${
              isCompactLayout ? 'inset-3 rounded-[126px]' : 'inset-4 rounded-[180px]'
            }`}
            style={{ transform: 'translateZ(1px)' }}
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={`${room.handNo}-${gameTitle.title}`}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 0.18, scale: 1 }}
                exit={{ opacity: 0, scale: 1.15 }}
                transition={{ duration: 0.4 }}
                className={`w-full text-center ${isCompactLayout ? 'px-6' : 'px-12'}`}
              >
                <div className={`font-black uppercase leading-none tracking-tighter text-white/70 ${isCompactLayout ? 'text-[13vw] sm:text-[17vw]' : 'text-[7vw] sm:text-[13vw]'}`}>
                  {gameTitle.title}
                </div>
                {gameTitle.subtitle && !isUltraCompact && (
                  <div className={`mt-2 font-bold uppercase text-white/45 ${isCompactLayout ? 'text-sm tracking-[0.25em]' : 'text-xl tracking-[0.45em]'}`}>
                    {gameTitle.subtitle}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          <div className={`z-10 flex ${isCompactLayout ? 'gap-1.5 sm:gap-2' : 'gap-2 sm:gap-4'}`} style={{ transform: 'translateZ(10px)' }}>
            <AnimatePresence>
              {(room.game?.communityCards ?? []).map((card) => (
                <motion.div
                  key={`${card.rank}-${card.suit}`}
                  initial={{ opacity: 0, y: -20, scale: 0.8 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                >
                  <CardComponent suit={card.suit} rank={card.rank} compact={isCompactLayout} />
                </motion.div>
              ))}
              {Array.from({ length: 5 - (room.game?.communityCards.length ?? 0) }).map((_, index) => (
                <div
                  key={`empty-${index}`}
                  className={`${isCompactLayout ? 'h-13 w-9 rounded-md sm:h-16 sm:w-12' : 'h-16 w-12 rounded-lg sm:h-24 sm:w-16'} border-2 border-emerald-700/30 bg-emerald-900/20`}
                />
              ))}
            </AnimatePresence>
          </div>

          <div className={`absolute left-1/2 flex -translate-x-1/2 flex-col items-center ${isCompactLayout ? 'top-[62%]' : 'top-[60%]'}`} style={{ transform: 'translateZ(20px)' }}>
            <div className={`mb-1 font-bold uppercase tracking-widest text-emerald-200/50 ${isCompactLayout ? 'text-[10px]' : 'text-xs sm:text-sm'}`}>Total Pot</div>
            <div className={`flex items-center gap-2 rounded-full border border-white/10 bg-black/40 backdrop-blur-sm ${isCompactLayout ? 'px-3 py-0.5' : 'px-4 py-1'}`}>
              <span className={`${isCompactLayout ? 'text-lg sm:text-xl' : 'text-xl sm:text-3xl'} font-mono font-bold text-yellow-400`}>${totalPot}</span>
            </div>
          </div>

          {displaySeats.map((slot, index) => {
            const positions = isCompactLayout
              ? [
                  { info: { left: '36%', top: '93%' }, cards: { left: '51%', top: '92%' }, chips: { left: '66%', top: '85%' } },
                  { info: { left: '96%', top: '66%' }, cards: { left: '83%', top: '64%' }, chips: { left: '74%', top: '64%' } },
                  { info: { left: '96%', top: '34%' }, cards: { left: '83%', top: '36%' }, chips: { left: '74%', top: '36%' } },
                  { info: { left: '63%', top: '12%' }, cards: { left: '49%', top: '16%' }, chips: { left: '49%', top: '29%' } },
                  { info: { left: '4%', top: '34%' }, cards: { left: '17%', top: '36%' }, chips: { left: '26%', top: '36%' } },
                  { info: { left: '4%', top: '66%' }, cards: { left: '17%', top: '64%' }, chips: { left: '26%', top: '64%' } },
                ]
              : [
                  { info: { left: '28%', top: '92%' }, cards: { left: '52%', top: '97%' }, chips: { left: '66%', top: '85%' } },
                  { info: { left: '105%', top: '65%' }, cards: { left: '88%', top: '65%' }, chips: { left: '76%', top: '65%' } },
                  { info: { left: '105%', top: '35%' }, cards: { left: '88%', top: '35%' }, chips: { left: '76%', top: '35%' } },
                  { info: { left: '28%', top: '8%' }, cards: { left: '52%', top: '8%' }, chips: { left: '52%', top: '25%' } },
                  { info: { left: '-5%', top: '35%' }, cards: { left: '12%', top: '35%' }, chips: { left: '24%', top: '35%' } },
                  { info: { left: '-5%', top: '65%' }, cards: { left: '12%', top: '65%' }, chips: { left: '24%', top: '65%' } },
                ];
            const pos = positions[index];
            const player = slot.player;

            if (!player) {
              return (
                <div
                  key={`empty-seat-${slot.seat}`}
                  className="absolute z-40"
                  style={{
                    left: pos.info.left,
                    top: pos.info.top,
                    transform: `translate(-50%, -50%) translateZ(40px) rotateX(-${tableTilt}deg)`,
                  }}
                >
                  {slot.enabled ? (
                    <button
                      onClick={() => addBotAtSeat(slot.seat)}
                      disabled={!hostCanEditSeats}
                      className={`min-w-[116px] rounded-2xl border border-dashed px-4 py-3 text-center text-xs uppercase tracking-[0.25em] transition ${
                        hostCanEditSeats
                          ? 'border-emerald-300/40 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/18'
                          : 'border-white/10 bg-slate-900/65 text-slate-500'
                      } disabled:cursor-default`}
                    >
                      <div>{hostCanEditSeats ? 'Add Bot' : 'Empty Seat'}</div>
                      <div className="mt-1 text-[10px] tracking-[0.16em] text-slate-400">{hostCanEditSeats ? `Seat ${slot.seat + 1}` : 'Open'}</div>
                    </button>
                  ) : (
                    <div className="min-w-[116px] rounded-2xl border border-dashed border-white/10 bg-slate-950/70 px-4 py-3 text-center text-xs uppercase tracking-[0.25em] text-slate-600">
                      <div>Closed Seat</div>
                      <div className="mt-1 text-[10px] tracking-[0.16em] text-slate-500">Increase max players</div>
                    </div>
                  )}
                </div>
              );
            }

            const isCurrent = room.game?.turnSeat === player.seat && room.game?.phase !== 'showdown';
            const isWinner = room.game?.showdown?.winnerIds.includes(player.id) ?? false;
            const renderCards =
              player.inHand &&
              (player.cards.length > 0 ? player.cards.map((card) => ({ card, hidden: false })) : [{ hidden: true }, { hidden: true }]);

            return (
              <React.Fragment key={player.id}>
                <div
                  className="absolute z-40 transition-all duration-300"
                  style={{
                    left: pos.info.left,
                    top: pos.info.top,
                    transform: `translate(-50%, -50%) translateZ(40px) rotateX(-${tableTilt}deg)`,
                  }}
                >
                  <div className={`flex min-w-[128px] items-center gap-2 rounded-2xl border bg-slate-800/90 p-2.5 shadow-2xl backdrop-blur-md ${
                    isCurrent ? 'scale-105 border-yellow-400 ring-2 ring-yellow-400/20' : isWinner ? 'border-emerald-400' : 'border-white/10'
                  }`}>
                    <div className={`relative flex h-10 w-10 items-center justify-center rounded-full border-2 ${
                      isCurrent ? 'border-yellow-400 bg-yellow-400/20' : isWinner ? 'border-emerald-400 bg-emerald-400/20' : 'border-white/20 bg-slate-900'
                    }`}>
                      {player.isBot ? <Bot size={18} className="text-white" /> : <User size={18} className="text-white" />}
                      {player.isHost && (
                        <div className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-slate-900 bg-white text-[8px] font-bold text-black">
                          H
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold text-white/90">{index === 0 ? 'You' : player.name}</div>
                      <div className="text-xs font-bold text-emerald-400">${player.stack}</div>
                      <div className="mt-1 flex flex-wrap gap-1 text-[10px] uppercase tracking-[0.2em] text-slate-400">
                        {player.isBot && <span>Bot</span>}
                        {!player.connected && !player.isBot && <span>Offline</span>}
                        {player.allIn && <span>All-in</span>}
                        {player.folded && <span>Folded</span>}
                      </div>
                    </div>
                    {hostCanEditSeats && player.isBot && (
                      <button
                        onClick={() => socketRef.current?.emit('room:remove-bot', { playerId: player.id })}
                        className="rounded-xl bg-white/8 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-200 transition hover:bg-white/15"
                      >
                        Remove
                      </button>
                    )}
                    {player.lastAction && (
                      <div className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-900 shadow-lg">
                        {player.lastAction}
                      </div>
                    )}
                  </div>
                </div>

                {renderCards && (
                  <div
                    className={`absolute z-20 flex ${isCompactLayout ? '-space-x-4' : '-space-x-6'}`}
                    style={{
                      left: pos.cards.left,
                      top: pos.cards.top,
                      transform: 'translate(-50%, -50%) translateZ(5px)',
                    }}
                  >
                    {renderCards.map((entry, cardIndex) => (
                      <motion.div key={`${player.id}-${cardIndex}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0, rotate: cardIndex === 0 ? -5 : 5 }}>
                        {entry.hidden ? (
                          <CardComponent hidden compact={isCompactLayout} className={`${player.folded ? 'opacity-30 grayscale' : 'shadow-xl'}`} />
                        ) : (
                          <CardComponent
                            suit={entry.card!.suit}
                            rank={entry.card!.rank}
                            compact={isCompactLayout}
                            className={`${player.folded ? 'opacity-30 grayscale' : 'shadow-xl'}`}
                          />
                        )}
                      </motion.div>
                    ))}
                  </div>
                )}

                {player.bet > 0 && (
                  <div
                    className="pointer-events-none absolute z-30"
                    style={{
                      left: pos.chips.left,
                      top: pos.chips.top,
                      transform: 'translate(-50%, -50%) translateZ(15px) rotateX(-15deg)',
                    }}
                  >
                    <ChipStack amount={player.bet} compact={isCompactLayout} />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>

        <div className={`absolute bottom-3 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center ${isCompactLayout ? 'bottom-2 w-[min(96vw,720px)] gap-2' : 'w-[min(92vw,900px)] gap-3'}`}>
          {!room.game || room.game.phase === 'showdown' ? (
            isHost ? (
              <button
                onClick={() => socketRef.current?.emit('game:start')}
                className={`group relative flex items-center gap-3 rounded-2xl border border-white/10 bg-emerald-500/95 font-bold text-white shadow-xl shadow-emerald-500/20 transition-all hover:scale-105 hover:bg-emerald-400 active:scale-95 ${isCompactLayout ? 'px-5 py-2 text-lg' : 'px-8 py-3 text-xl'}`}
              >
                <Play size={isCompactLayout ? 18 : 20} fill="currentColor" />
                {room.game?.phase === 'showdown' ? 'Start Next Hand' : 'Start Hand'}
              </button>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-slate-950/80 px-5 py-3 text-sm text-slate-300 shadow-xl backdrop-blur-xl">
                Waiting for the host to start the next hand.
              </div>
            )
          ) : (
            <div className="flex w-full items-end justify-between gap-2">
              <div className={`flex items-center rounded-2xl border border-white/10 bg-slate-900/78 backdrop-blur-xl shadow-xl ${isCompactLayout ? 'gap-1.5 px-1.5 py-1.5' : 'gap-2 px-2 py-2'}`}>
                <button
                  disabled={!actions.fold}
                  onClick={() => sendAction({ action: 'fold' })}
                  className={`rounded-2xl border border-white/10 bg-slate-800/90 font-bold shadow-xl transition-all hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-30 ${isCompactLayout ? 'px-3 py-2 text-sm' : 'px-4 py-3 text-base'}`}
                >
                  Fold
                </button>
                <button
                  disabled={!actions.check && !actions.call}
                  onClick={() => sendAction({ action: actions.toCall > 0 ? 'call' : 'check' })}
                  className={`rounded-2xl border border-white/10 bg-blue-600/95 font-bold shadow-xl shadow-blue-600/20 transition-all hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-30 ${isCompactLayout ? 'px-3 py-2 text-sm' : 'px-4 py-3 text-base'}`}
                >
                  {actions.toCall > 0 ? `Call $${actions.toCall}` : 'Check'}
                </button>
              </div>

              <div className={`flex flex-col rounded-2xl border border-white/10 bg-slate-900/78 backdrop-blur-xl shadow-xl ${isCompactLayout ? 'gap-1.5 px-1.5 py-1.5' : 'gap-2 px-2 py-2'}`}>
                <div className="flex items-center justify-center gap-2">
                  <div className={`flex flex-col items-center ${isCompactLayout ? 'px-0.5' : 'px-1.5'}`}>
                    <span className={`${isCompactLayout ? 'text-[8px]' : 'text-[10px]'} font-bold uppercase tracking-widest text-slate-400`}>Raise To</span>
                    <span className={`${isCompactLayout ? 'text-base' : 'text-xl'} font-mono font-bold text-yellow-400`}>${betAmount}</span>
                  </div>
                  <div className="flex gap-1 overflow-x-auto no-scrollbar">
                    {[5, 10, 50, 100].map((value) => (
                      <button
                        key={value}
                        disabled={!actions.raise}
                        onClick={() => setBetAmount((current) => Math.min(maxRaiseTo, current + value))}
                        className={`${isCompactLayout ? 'h-7 w-7 text-[10px]' : 'h-9 w-9 text-xs'} flex-shrink-0 rounded-xl bg-slate-700 font-bold transition-colors hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-30`}
                      >
                        +{value}
                      </button>
                    ))}
                    <button
                      disabled={!actions.raise}
                      onClick={() => setBetAmount(minRaiseTo || betAmount)}
                      className={`${isCompactLayout ? 'h-7 w-7 text-[10px]' : 'h-9 w-9 text-xs'} flex-shrink-0 rounded-xl bg-slate-700 font-bold transition-colors hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-30`}
                    >
                      Min
                    </button>
                  </div>
                  <button
                    disabled={!actions.raise || betAmount <= (room.game?.currentBet ?? 0)}
                    onClick={() => sendAction({ action: 'raise', raiseTo: betAmount })}
                    className={`rounded-2xl border border-white/10 bg-emerald-600/95 font-bold shadow-xl shadow-emerald-600/20 transition-all hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-30 ${isCompactLayout ? 'px-3 py-2 text-sm' : 'px-4 py-3 text-base'}`}
                  >
                    Raise
                  </button>
                </div>
                <input
                  type="range"
                  min={minRaiseTo || 0}
                  max={maxRaiseTo || 0}
                  step={5}
                  value={Math.min(Math.max(betAmount, minRaiseTo || 0), maxRaiseTo || 0)}
                  disabled={!actions.raise || maxRaiseTo <= 0}
                  onChange={(event) => setBetAmount(Number(event.target.value))}
                  className={`w-full accent-emerald-500 ${!actions.raise || maxRaiseTo <= 0 ? 'opacity-30' : ''}`}
                />
              </div>
            </div>
          )}
        </div>
      </main>

      {settingsOpen && isHost && (
        <div className="absolute inset-0 z-[90] overflow-auto bg-black/55 px-4 py-4 backdrop-blur-sm">
          <div className={`mx-auto rounded-[30px] border border-white/10 bg-slate-950/95 shadow-2xl ${isLandscapePhone ? 'max-w-5xl p-5' : 'max-w-md p-6'}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.35em] text-emerald-300/80">Host Controls</div>
                <h2 className="mt-2 text-2xl font-black">Room Settings</h2>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  {room.game && room.game.phase !== 'showdown'
                    ? 'The current hand is live. Changes will be queued for the next hand.'
                    : 'Changes sync immediately; save keeps them, cancel restores the values from when this panel was opened.'}
                </p>
                {invalidPlayerCountDuringHand && (
                  <p className="mt-2 text-sm leading-6 text-amber-200">
                    During an active hand, max players cannot be saved above the number of seated players currently at the table.
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {settingsDirty ? (
                  <>
                    <button
                      onClick={saveSettings}
                      disabled={!canSaveSettings}
                      className="rounded-2xl bg-emerald-400 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                    >
                      Save
                    </button>
                    <button onClick={cancelSettings} className="rounded-2xl bg-white/5 px-3 py-2 text-sm text-slate-300 transition hover:bg-white/10">
                      Cancel
                    </button>
                  </>
                ) : (
                  <button onClick={() => setSettingsOpen(false)} className="rounded-2xl bg-white/5 px-3 py-2 text-sm text-slate-300 transition hover:bg-white/10">
                    Close
                  </button>
                )}
              </div>
            </div>

            <div className={`mt-6 ${isLandscapePhone ? 'grid grid-cols-[1fr_1.05fr] gap-5' : 'space-y-5'}`}>
              <div className={`space-y-5 ${isLandscapePhone ? 'pr-1' : ''}`}>

                <div>
                <div className="mb-2 text-xs uppercase tracking-[0.25em] text-slate-400">Max Players</div>
                <div className="grid grid-cols-5 gap-2">
                  {[2, 3, 4, 5, 6].map((count) => (
                    <button
                      key={count}
                      onClick={() => applySettingsUpdate((current) => ({ ...current, maxPlayers: count }))}
                      className={`rounded-2xl px-3 py-2 text-sm font-bold transition ${
                        settingsDraft.maxPlayers === count ? 'bg-emerald-400 text-slate-950' : 'bg-white/5 text-slate-300 hover:bg-white/10'
                      }`}
                    >
                      {count}
                    </button>
                  ))}
                </div>
                </div>
              </div>

              <div className={`space-y-5 ${isLandscapePhone ? 'pl-1' : ''}`}>
                <div>
                <div className="mb-2 text-xs uppercase tracking-[0.25em] text-slate-400">Preset</div>
                <div className="grid grid-cols-3 gap-2">
                  {(['standard', 'short', 'custom'] as RoomPreset[]).map((preset) => (
                    <button
                      key={preset}
                      onClick={() => updatePreset(preset)}
                      className={`rounded-2xl px-3 py-2 text-sm font-bold capitalize transition ${
                        settingsDraft.preset === preset ? 'bg-cyan-400 text-slate-950' : 'bg-white/5 text-slate-300 hover:bg-white/10'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                </div>

                <div>
                  <div className="mb-2 text-xs uppercase tracking-[0.25em] text-slate-400">Removed Ranks</div>
                  <div className="grid grid-cols-4 gap-2">
                    {RANKS.map((rank) => (
                      <button
                        key={rank}
                        onClick={() => toggleRemovedRank(rank)}
                        disabled={settingsDraft.preset === 'standard' || settingsDraft.preset === 'short'}
                        className={`rounded-2xl px-3 py-2 text-sm font-bold transition ${
                          settingsDraft.removedRanks.includes(rank)
                            ? 'bg-amber-300 text-slate-950'
                            : 'bg-white/5 text-slate-300 hover:bg-white/10'
                        } disabled:cursor-not-allowed disabled:opacity-40`}
                      >
                        {rank}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-sm font-semibold text-white">Seat management</div>
                  <div className="mt-2 text-xs leading-5 text-slate-400">
                    Empty seats within the current player limit can host bots. Seats beyond the current limit stay closed until you raise max players.
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
                    <span className="rounded-full bg-white/6 px-3 py-1">Tap empty seat: add bot</span>
                    <span className="rounded-full bg-white/6 px-3 py-1">Tap bot seat: remove bot</span>
                    <span className="rounded-full bg-white/6 px-3 py-1">Disabled during active hands</span>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

      <Toast message={notice?.message ?? null} tone={notice?.tone ?? 'error'} />
    </div>
  );

  function showNotice(message: string, tone: 'error' | 'success') {
    setError(tone === 'error' ? message : null);
    setNotice({ message, tone });
    window.setTimeout(() => {
      setNotice((current) => (current?.message === message ? null : current));
      if (tone === 'error') {
        setError((current) => (current === message ? null : current));
      }
    }, 3200);
  }

  function showError(message: string) {
    showNotice(message, 'error');
  }
}

function mapDisplaySeats(room: RoomSnapshot | null, selfSeat: number): DisplaySeatSlot[] {
  const display = Array.from({ length: 6 }, (_, relativeIndex) => {
    const absoluteSeat = (selfSeat + relativeIndex) % 6;
    return {
      seat: absoluteSeat,
      enabled: room ? absoluteSeat < room.maxPlayers : true,
      player: null as PlayerLike | null,
    };
  });
  if (!room) return display;

  for (const player of room.players) {
    const relativeSeat = (player.seat - selfSeat + 6) % 6;
    display[relativeSeat] = {
      seat: player.seat,
      enabled: player.seat < room.maxPlayers,
      player,
    };
  }

  return display;
}

function getGameMessage(room: RoomSnapshot | null) {
  if (!room?.game) {
    return { title: 'Ready', subtitle: 'Host can start a hand anytime' };
  }

  const showdown = room.game.showdown;
  if (room.game.phase === 'showdown' && showdown) {
    return {
      title: 'Showdown',
      subtitle: `${showdown.winnerNames} · ${showdown.winningHand}`,
    };
  }

  const phaseLabels: Record<string, string> = {
    'pre-flop': 'Pre-Flop',
    flop: 'Flop',
    turn: 'Turn',
    river: 'River',
  };

  return {
    title: phaseLabels[room.game.phase] ?? 'Table',
    subtitle: `${configLabel(room.config)} · Hand #${room.handNo}`,
  };
}

function toMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : 'Unexpected error.';
}

function readErrorMessage(payload: EnterRoomResponse | { message?: string }, fallback: string) {
  return 'message' in payload ? payload.message ?? fallback : fallback;
}

function Toast({ message, tone }: { message: string | null; tone: 'error' | 'success' }) {
  if (!message) return null;
  return (
    <div
      className={`pointer-events-none fixed bottom-5 left-1/2 z-[100] -translate-x-1/2 rounded-full px-4 py-2 text-sm shadow-2xl backdrop-blur-md ${
        tone === 'success'
          ? 'border border-emerald-300/20 bg-emerald-400/15 text-emerald-100'
          : 'border border-red-300/20 bg-red-400/15 text-red-100'
      }`}
    >
      {message}
    </div>
  );
}

function areRoomConfigsEqual(left: RoomConfig, right: RoomConfig) {
  return (
    left.maxPlayers === right.maxPlayers &&
    left.preset === right.preset &&
    left.fillBots === right.fillBots &&
    left.removedRanks.length === right.removedRanks.length &&
    left.removedRanks.every((rank, index) => rank === right.removedRanks[index])
  );
}

function cloneConfig(config: RoomConfig): RoomConfig {
  return {
    ...config,
    removedRanks: [...config.removedRanks],
  };
}

type PlayerLike = RoomSnapshot['players'][number];
type DisplaySeatSlot = {
  seat: number;
  enabled: boolean;
  player: PlayerLike | null;
};
