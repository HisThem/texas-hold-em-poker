import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import confetti from 'canvas-confetti';
import { 
  Player, 
  GameState, 
  Card, 
  createDeck, 
  GamePhase, 
  CHIP_VALUES 
} from './types';
import { evaluateHand } from './engine';
import { CardComponent } from './components/Card';
import { ChipStack } from './components/Chips';
import { User, Trophy, Coins, Play } from 'lucide-react';

const INITIAL_CHIPS = 1000;
const SMALL_BLIND = 10;
const BIG_BLIND = 20;

const PLAYER_NAMES = ['You', 'Alex', 'Jordan', 'Casey', 'Riley', 'Quinn'];

export default function App() {
  const [gameState, setGameState] = useState<GameState>({
    players: [],
    communityCards: [],
    pot: 0,
    phase: 'waiting',
    currentPlayerIndex: 0,
    dealerIndex: 0,
    smallBlind: SMALL_BLIND,
    bigBlind: BIG_BLIND,
    currentBet: 0,
    deck: [],
    winners: [],
  });

  const [gameMessage, setGameMessage] = useState<{title: string, subtitle?: string}>({
    title: "Welcome",
    subtitle: "Texas Hold'em Poker"
  });
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

  const isMobile = viewport.width < 768;
  const isShortViewport = viewport.height > 0 && viewport.height < 520;
  const isCompactLayout = isMobile || isShortViewport;
  const isUltraCompact = viewport.height > 0 && viewport.height < 430;
  const tableTilt = isCompactLayout ? 26 : 35;
  const tableScale = isUltraCompact ? 0.78 : isCompactLayout ? 0.9 : 1.04;

  const initGame = useCallback((numPlayers: number = 6) => {
    const deck = createDeck();
    const players: Player[] = Array.from({ length: numPlayers }, (_, i) => ({
      id: i === 0 ? 'user' : `bot-${i}`,
      name: PLAYER_NAMES[i],
      chips: INITIAL_CHIPS,
      bet: 0,
      cards: [],
      isFolded: false,
      isAllIn: false,
      isDealer: i === 0,
      isSmallBlind: i === 1 % numPlayers,
      isBigBlind: i === 2 % numPlayers,
    }));

    setGameState({
      players,
      communityCards: [],
      pot: 0,
      phase: 'waiting',
      currentPlayerIndex: 0,
      dealerIndex: 0,
      smallBlind: SMALL_BLIND,
      bigBlind: BIG_BLIND,
      currentBet: 0,
      deck,
      winners: [],
    });
    setGameMessage({ title: "Ready?", subtitle: "Click Start Hand to begin" });
  }, []);

  useEffect(() => {
    initGame();
  }, [initGame]);

  const startHand = () => {
    let { players, dealerIndex, deck, smallBlind, bigBlind } = gameState;
    deck = createDeck();
    
    // Move dealer
    const newDealerIndex = (dealerIndex + 1) % players.length;
    const sbIndex = (newDealerIndex + 1) % players.length;
    const bbIndex = (newDealerIndex + 2) % players.length;

    const newPlayers = players.map((p, i) => {
      const cards = [deck.pop()!, deck.pop()!];
      let bet = 0;
      let chips = p.chips;

      if (i === sbIndex) {
        const amount = Math.min(chips, smallBlind);
        bet = amount;
        chips -= amount;
      } else if (i === bbIndex) {
        const amount = Math.min(chips, bigBlind);
        bet = amount;
        chips -= amount;
      }

      return {
        ...p,
        cards,
        bet,
        chips,
        isFolded: false,
        isAllIn: chips === 0 && bet > 0,
        isDealer: i === newDealerIndex,
        isSmallBlind: i === sbIndex,
        isBigBlind: i === bbIndex,
        lastAction: i === sbIndex ? 'SB' : i === bbIndex ? 'BB' : undefined,
      };
    });

    setGameState(prev => ({
      ...prev,
      players: newPlayers,
      deck,
      communityCards: [],
      pot: newPlayers.reduce((sum, p) => sum + p.bet, 0),
      phase: 'pre-flop',
      currentPlayerIndex: (bbIndex + 1) % players.length,
      currentBet: bigBlind,
      dealerIndex: newDealerIndex,
      winners: [],
      winningHand: undefined,
    }));
    setGameMessage({ title: "Pre-flop", subtitle: "Place your bets!" });
  };

  const nextPhase = useCallback(() => {
    setGameState(prev => {
      const { phase, deck, communityCards, players } = prev;
      let newPhase: GamePhase = phase;
      let newCommunity = [...communityCards];
      let newDeck = [...deck];

      // Collect bets into pot
      const roundPot = players.reduce((sum, p) => sum + p.bet, 0);
      const updatedPlayers = players.map(p => ({ ...p, bet: 0, lastAction: undefined }));

      if (phase === 'pre-flop') {
        newPhase = 'flop';
        newCommunity = [newDeck.pop()!, newDeck.pop()!, newDeck.pop()!];
        setGameMessage({ title: "Flop", subtitle: "Three cards revealed" });
      } else if (phase === 'flop') {
        newPhase = 'turn';
        newCommunity.push(newDeck.pop()!);
        setGameMessage({ title: "Turn", subtitle: "Fourth card revealed" });
      } else if (phase === 'turn') {
        newPhase = 'river';
        newCommunity.push(newDeck.pop()!);
        setGameMessage({ title: "River", subtitle: "Final card revealed" });
      } else if (phase === 'river') {
        newPhase = 'showdown';
        setGameMessage({ title: "Showdown", subtitle: "Reveal your cards!" });
      }

      return {
        ...prev,
        phase: newPhase,
        communityCards: newCommunity,
        deck: newDeck,
        pot: prev.pot + roundPot,
        players: updatedPlayers,
        currentBet: 0,
        currentPlayerIndex: (prev.dealerIndex + 1) % players.length,
      };
    });
  }, []);

  const handleAction = useCallback((action: 'fold' | 'check' | 'call' | 'raise', amount: number = 0) => {
    setGameState(prev => {
      const { players, currentPlayerIndex, currentBet, pot } = prev;
      const player = players[currentPlayerIndex];
      let newPlayers = [...players];
      let newPot = pot;
      let newCurrentBet = currentBet;
      let actionText = '';

      if (action === 'fold') {
        newPlayers[currentPlayerIndex] = { ...player, isFolded: true, lastAction: 'Fold' };
        actionText = 'Fold';
      } else if (action === 'check' || action === 'call') {
        const callAmount = currentBet - player.bet;
        const actualCall = Math.min(player.chips, callAmount);
        newPlayers[currentPlayerIndex] = {
          ...player,
          chips: player.chips - actualCall,
          bet: player.bet + actualCall,
          isAllIn: player.chips - actualCall === 0,
          lastAction: callAmount === 0 ? 'Check' : 'Call',
        };
        actionText = callAmount === 0 ? 'Check' : 'Call';
      } else if (action === 'raise') {
        const raiseTo = amount;
        const addedBet = raiseTo - player.bet;
        newPlayers[currentPlayerIndex] = {
          ...player,
          chips: player.chips - addedBet,
          bet: raiseTo,
          isAllIn: player.chips - addedBet === 0,
          lastAction: `Raise ${raiseTo}`,
        };
        newCurrentBet = raiseTo;
        actionText = `Raise to ${raiseTo}`;
      }

      // Check if round is over
      const activePlayers = newPlayers.filter(p => !p.isFolded && !p.isAllIn);
      const allBetsEqual = newPlayers.every(p => p.isFolded || p.isAllIn || p.bet === newCurrentBet);
      const everyoneActed = newPlayers.every(p => p.isFolded || p.isAllIn || p.lastAction !== undefined);

      let nextIndex = (currentPlayerIndex + 1) % players.length;
      while (newPlayers[nextIndex].isFolded || newPlayers[nextIndex].isAllIn) {
        nextIndex = (nextIndex + 1) % players.length;
        if (nextIndex === currentPlayerIndex) break;
      }

      const roundOver = (allBetsEqual && everyoneActed) || activePlayers.length <= 1;

      return {
        ...prev,
        players: newPlayers,
        currentBet: newCurrentBet,
        currentPlayerIndex: nextIndex,
      };
    });
  }, []);

  // Bot Logic
  useEffect(() => {
    if (gameState.phase !== 'waiting' && gameState.phase !== 'showdown') {
      const currentPlayer = gameState.players[gameState.currentPlayerIndex];
      if (currentPlayer && currentPlayer.id.startsWith('bot-')) {
        const timer = setTimeout(() => {
          const { currentBet } = gameState;
          const callAmount = currentBet - currentPlayer.bet;
          
          // Simple bot AI
          const rand = Math.random();
          if (callAmount > currentPlayer.chips * 0.5 && rand < 0.3) {
            handleAction('fold');
          } else if (callAmount > 0) {
            handleAction('call');
          } else {
            if (rand > 0.8) {
              handleAction('raise', currentBet + BIG_BLIND);
            } else {
              handleAction('check');
            }
          }
        }, 1000);
        return () => clearTimeout(timer);
      }
    }
  }, [gameState.currentPlayerIndex, gameState.phase, handleAction]);

  // Phase transition check
  useEffect(() => {
    if (gameState.phase === 'waiting' || gameState.phase === 'showdown') return;

    const activePlayers = gameState.players.filter(p => !p.isFolded);
    if (activePlayers.length === 1) {
      // Everyone folded
      const winner = activePlayers[0];
      const totalPot = gameState.pot + gameState.players.reduce((s, p) => s + p.bet, 0);
      setGameState(prev => ({
        ...prev,
        phase: 'showdown',
        winners: [winner.id],
        players: prev.players.map(p => p.id === winner.id ? { ...p, chips: p.chips + totalPot } : p),
        pot: 0,
      }));
      setGameMessage({ title: "Winner!", subtitle: `${winner.name} wins the pot!` });
      return;
    }

    const allBetsEqual = gameState.players.every(p => p.isFolded || p.isAllIn || p.bet === gameState.currentBet);
    const everyoneActed = gameState.players.every(p => p.isFolded || p.isAllIn || p.lastAction !== undefined);

    if (allBetsEqual && everyoneActed) {
      if (gameState.phase === 'river') {
        // Showdown
        const showdownPlayers = gameState.players.filter(p => !p.isFolded);
        const results = showdownPlayers.map(p => ({
          id: p.id,
          result: evaluateHand([...p.cards, ...gameState.communityCards])
        }));
        
        results.sort((a, b) => b.result.value - a.result.value);
        const bestValue = results[0].result.value;
        const winners = results.filter(r => r.result.value === bestValue);
        
        const totalPot = gameState.pot + gameState.players.reduce((s, p) => s + p.bet, 0);
        const winAmount = Math.floor(totalPot / winners.length);

        setGameState(prev => ({
          ...prev,
          phase: 'showdown',
          winners: winners.map(w => w.id),
          winningHand: results[0].result.name,
          players: prev.players.map(p => {
            if (winners.some(w => w.id === p.id)) {
              return { ...p, chips: p.chips + winAmount };
            }
            return p;
          }),
          pot: 0,
        }));
        
        if (winners.some(w => w.id === 'user')) {
          confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
        }
        
        const winnerNames = winners.map(w => gameState.players.find(p => p.id === w.id)?.name).join(', ');
        setGameMessage({ title: "Showdown!", subtitle: `${winnerNames} wins with ${results[0].result.name}` });
      } else {
        nextPhase();
      }
    }
  }, [gameState.players, gameState.currentBet, gameState.phase, nextPhase]);

  const user = gameState.players.find(p => p.id === 'user');
  const isUserTurn = gameState.currentPlayerIndex === 0 && gameState.phase !== 'waiting' && gameState.phase !== 'showdown';

  return (
    <div className="h-[100dvh] bg-slate-900 text-white font-sans overflow-hidden relative">
      {/* Game Table */}
      <main className={`h-full relative flex items-center justify-center perspective-[1500px] overflow-hidden ${isCompactLayout ? 'px-1 py-1 sm:px-2' : 'p-2 sm:p-8'}`}>
        {/* The Table Wrapper with 3D Rotation (No clipping) */}
        <div 
          className="relative w-full max-w-5xl max-h-full aspect-[16/9] flex items-center justify-center transition-transform duration-700"
          style={{ 
            transform: `rotateX(${tableTilt}deg) scale(${tableScale})`,
            transformStyle: 'preserve-3d'
          }}
        >
          {/* Visual Table Surface (Felt, Border, Shadow) */}
          <div className={`absolute inset-0 bg-emerald-800 ${isCompactLayout ? 'rounded-[140px] border-[8px]' : 'rounded-[200px] border-[12px]'} border-amber-900 shadow-[0_50px_100px_rgba(0,0,0,0.6),inset_0_0_50px_rgba(0,0,0,0.3)] pointer-events-none`}></div>
          
          {/* Inner Rail */}
          <div className={`absolute ${isCompactLayout ? 'inset-3 rounded-[126px]' : 'inset-4 rounded-[180px]'} border-2 border-emerald-700/50 pointer-events-none`}></div>

          {/* Game Phase/Message - Printed on the felt */}
          <div className="absolute inset-0 z-0 pointer-events-none select-none flex items-center justify-center overflow-hidden" style={{ transform: 'translateZ(1px)' }}>
            <AnimatePresence mode="wait">
              {gameMessage && (
                <motion.div 
                  key={gameMessage.title}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 0.2, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.2 }}
                  transition={{ duration: 0.4 }}
                  className={`text-center w-full ${isCompactLayout ? 'px-6' : 'px-12'}`}
                >
                  <div className={`text-white font-black uppercase tracking-tighter leading-none whitespace-nowrap opacity-60 select-none ${isCompactLayout ? 'text-[13vw] sm:text-[17vw]' : 'text-[7vw] sm:text-[13vw]'}`}>
                    {gameMessage.title}
                  </div>
                  {gameMessage.subtitle && !isUltraCompact && (
                    <div className={`text-white font-bold uppercase mt-2 opacity-50 ${isCompactLayout ? 'text-sm sm:text-base tracking-[0.25em]' : 'text-xl sm:text-3xl tracking-[0.5em]'}`}>
                      {gameMessage.subtitle}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Community Cards */}
          <div className={`flex z-10 ${isCompactLayout ? 'gap-1.5 sm:gap-2' : 'gap-2 sm:gap-4'}`} style={{ transform: 'translateZ(10px)' }}>
            <AnimatePresence>
              {gameState.communityCards.map((card, i) => (
                <motion.div
                  key={`${card.rank}-${card.suit}`}
                  initial={{ opacity: 0, y: -20, scale: 0.8 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ delay: i * 0.1 }}
                >
                  <CardComponent suit={card.suit} rank={card.rank} compact={isCompactLayout} />
                </motion.div>
              ))}
              {Array.from({ length: 5 - gameState.communityCards.length }).map((_, i) => (
                <div key={`empty-${i}`} className={`${isCompactLayout ? 'w-9 h-13 sm:w-12 sm:h-16 rounded-md' : 'w-12 h-16 sm:w-16 sm:h-24 rounded-lg'} border-2 border-emerald-700/30 bg-emerald-900/20`}></div>
              ))}
            </AnimatePresence>
          </div>

          {/* Pot Display */}
          <div className={`absolute left-1/2 -translate-x-1/2 flex flex-col items-center ${isCompactLayout ? 'top-[62%]' : 'top-[60%]'}`} style={{ transform: 'translateZ(20px)' }}>
            <div className={`text-emerald-200/50 uppercase font-bold tracking-widest mb-1 ${isCompactLayout ? 'text-[10px]' : 'text-xs sm:text-sm'}`}>Total Pot</div>
            <div className={`bg-black/40 backdrop-blur-sm rounded-full border border-white/10 flex items-center gap-2 ${isCompactLayout ? 'px-3 py-0.5' : 'px-4 py-1'}`}>
              <Coins size={isCompactLayout ? 12 : 14} className="text-yellow-400" />
              <span className={`${isCompactLayout ? 'text-lg sm:text-xl' : 'text-xl sm:text-3xl'} font-mono font-bold text-yellow-400`}>${gameState.pot}</span>
            </div>
          </div>

          {/* Players */}
          {gameState.players.map((player, i) => {
            // Define positions for 6 players in a landscape-friendly layout
            // Adjusted for 3D perspective: cards closer to edge, chips in front
            const positions = isCompactLayout ? [
              { info: { left: '36%', top: '93%' }, cards: { left: '51%', top: '92%' }, chips: { left: '66%', top: '85%' }, orient: 'horizontal' },
              { info: { left: '91%', top: '66%' }, cards: { left: '78%', top: '64%' }, chips: { left: '69%', top: '64%' }, orient: 'horizontal' },
              { info: { left: '91%', top: '34%' }, cards: { left: '78%', top: '36%' }, chips: { left: '69%', top: '36%' }, orient: 'horizontal' },
              { info: { left: '36%', top: '10%' }, cards: { left: '51%', top: '16%' }, chips: { left: '51%', top: '28%' }, orient: 'horizontal' },
              { info: { left: '9%', top: '34%' }, cards: { left: '22%', top: '36%' }, chips: { left: '31%', top: '36%' }, orient: 'horizontal' },
              { info: { left: '9%', top: '66%' }, cards: { left: '22%', top: '64%' }, chips: { left: '31%', top: '64%' }, orient: 'horizontal' },
            ] : [
              { info: { left: '28%', top: '92%' }, cards: { left: '52%', top: '97%' }, chips: { left: '66%', top: '85%' }, orient: 'horizontal' }, // P0: Bottom Center (User)
              { info: { left: '105%', top: '65%' }, cards: { left: '88%', top: '65%' }, chips: { left: '76%', top: '65%' }, orient: 'horizontal' },   // P1: Right Bottom
              { info: { left: '105%', top: '35%' }, cards: { left: '88%', top: '35%' }, chips: { left: '76%', top: '35%' }, orient: 'horizontal' },   // P2: Right Top
              { info: { left: '28%', top: '8%' }, cards: { left: '52%', top: '8%' }, chips: { left: '52%', top: '25%' }, orient: 'horizontal' }, // P3: Top Center
              { info: { left: '-5%', top: '35%' }, cards: { left: '12%', top: '35%' }, chips: { left: '24%', top: '35%' }, orient: 'horizontal' },    // P4: Left Top
              { info: { left: '-5%', top: '65%' }, cards: { left: '12%', top: '65%' }, chips: { left: '24%', top: '65%' }, orient: 'horizontal' },    // P5: Left Bottom
            ];

            const pos = positions[i] || positions[0];
            const isCurrent = gameState.currentPlayerIndex === i && gameState.phase !== 'showdown';
            const isWinner = gameState.winners.includes(player.id);

            return (
              <React.Fragment key={player.id}>
                {/* Player Info - OUTSIDE the table */}
                <div 
                  className="absolute z-40 transition-all duration-300"
                  style={{ 
                    left: pos.info.left, 
                    top: pos.info.top, 
                    transform: `translate(-50%, -50%) translateZ(40px) rotateX(-${tableTilt}deg)`,
                  }}
                >
                  <div className={`flex ${pos.orient === 'vertical' ? 'flex-col' : 'flex-row'} items-center ${isCompactLayout ? 'gap-2' : 'gap-2.5'} ${isCompactLayout ? 'p-2' : 'p-2 sm:p-2.5'} rounded-2xl bg-slate-800/90 backdrop-blur-md border shadow-2xl ${
                    pos.orient === 'vertical'
                      ? isCompactLayout ? 'min-w-[76px] py-2' : 'min-w-[88px] sm:min-w-[108px] py-2.5 sm:py-3'
                      : isCompactLayout ? 'min-w-[112px]' : 'min-w-[128px] sm:min-w-[148px]'
                  } ${
                    isCurrent ? 'border-yellow-400 ring-2 ring-yellow-400/20 scale-105' : 
                    isWinner ? 'border-emerald-400' : 'border-white/10'
                  }`}>
                    {/* Avatar */}
                    <div className={`${isCompactLayout ? 'w-8 h-8' : 'w-9 h-9 sm:w-12 sm:h-12'} rounded-full border-2 flex items-center justify-center relative flex-shrink-0 ${
                      isCurrent ? 'border-yellow-400 bg-yellow-400/20' : 
                      isWinner ? 'border-emerald-400 bg-emerald-400/20' : 
                      player.isFolded ? 'border-slate-600 bg-slate-900 opacity-50' : 'border-white/20 bg-slate-900'
                    }`}>
                      <User size={isCompactLayout ? 16 : isMobile ? 18 : 20} className={player.isFolded ? 'text-slate-500' : 'text-white'} />
                      {player.isDealer && (
                        <div className={`absolute -right-1 -top-1 bg-white text-black rounded-full flex items-center justify-center font-bold border border-slate-900 ${isCompactLayout ? 'w-4 h-4 text-[8px]' : 'w-4 h-4 sm:w-5 sm:h-5 text-[8px] sm:text-[9px]'}`}>D</div>
                      )}
                    </div>

                    {/* Name & Chips */}
                    <div className={`flex flex-col justify-center overflow-hidden ${pos.orient === 'vertical' ? 'items-center' : ''}`}>
                      <div className={`${isCompactLayout ? 'text-xs' : 'text-sm sm:text-base'} font-bold truncate text-white/90 w-full text-center`}>{player.name}</div>
                      <div className={`${isCompactLayout ? 'text-[10px]' : 'text-xs sm:text-sm'} text-emerald-400 font-mono font-bold`}>${player.chips}</div>
                    </div>

                    {/* Action Bubble */}
                    {player.lastAction && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.5 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className={`absolute left-1/2 -translate-x-1/2 bg-white text-slate-900 font-bold rounded-full shadow-lg whitespace-nowrap ${isCompactLayout ? '-top-5 text-[9px] px-1.5 py-0.5' : '-top-6 text-[10px] px-2 py-0.5'}`}
                      >
                        {player.lastAction}
                      </motion.div>
                    )}
                  </div>
                </div>

                {/* Player Cards - ON the table, closer to edge */}
                <div 
                  className={`absolute z-20 flex ${isCompactLayout ? '-space-x-4' : '-space-x-6'}`}
                  style={{ 
                    left: pos.cards.left, 
                    top: pos.cards.top, 
                    transform: 'translate(-50%, -50%) translateZ(5px)' 
                  }}
                >
                  {player.cards.map((card, ci) => (
                    <motion.div
                      key={ci}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0, rotate: ci === 0 ? -5 : 5 }}
                    >
                      <CardComponent 
                        suit={card.suit} 
                        rank={card.rank} 
                        compact={isCompactLayout}
                        hidden={player.id !== 'user' && gameState.phase !== 'showdown'} 
                        className={`${isCompactLayout ? 'scale-100' : 'scale-[0.85] sm:scale-95'} ${player.isFolded ? 'grayscale opacity-30' : 'shadow-xl'}`}
                      />
                    </motion.div>
                  ))}
                </div>

                {/* Player Bet Chips - ON the table, in front of cards */}
                {player.bet > 0 && (
                  <div 
                    className="absolute z-30 pointer-events-none"
                    style={{ 
                      left: pos.chips.left, 
                      top: pos.chips.top, 
                      transform: 'translate(-50%, -50%) translateZ(15px) rotateX(-15deg)' 
                    }}
                  >
                    <ChipStack amount={player.bet} orientation={pos.orient as any} compact={isCompactLayout} />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Floating Action Controls */}
        <div className={`absolute bottom-3 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center ${isCompactLayout ? 'gap-2 bottom-2 w-[min(96vw,720px)]' : 'gap-3 w-[min(92vw,900px)]'}`}>
          {gameState.phase === 'waiting' || gameState.phase === 'showdown' ? (
            <button 
              onClick={startHand}
              className={`group relative flex items-center bg-emerald-500/95 hover:bg-emerald-400 text-white rounded-2xl font-bold transition-all hover:scale-105 active:scale-95 shadow-xl shadow-emerald-500/20 border border-white/10 ${isCompactLayout ? 'gap-2 px-5 py-2 text-lg' : 'gap-3 px-8 py-3 text-xl'}`}
            >
              <Play fill="currentColor" size={isCompactLayout ? 18 : 20} />
              {gameState.phase === 'showdown' ? 'Next Hand' : 'Start Hand'}
            </button>
          ) : (
            <div className="flex w-full items-end justify-between gap-2">
              <div className={`flex items-center bg-slate-900/78 backdrop-blur-xl border border-white/10 shadow-xl rounded-2xl ${isCompactLayout ? 'gap-1.5 px-1.5 py-1.5' : 'gap-2 px-2 py-2'}`}>
                <button 
                  disabled={!isUserTurn}
                  onClick={() => handleAction('fold')}
                  className={`bg-slate-800/90 backdrop-blur-md hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed rounded-2xl font-bold transition-all border border-white/10 shadow-xl whitespace-nowrap ${isCompactLayout ? 'px-3 py-2 text-sm' : 'px-4 py-3 text-base'}`}
                >
                  Fold
                </button>
                <button 
                  disabled={!isUserTurn}
                  onClick={() => handleAction(gameState.currentBet > (user?.bet || 0) ? 'call' : 'check')}
                  className={`bg-blue-600/95 backdrop-blur-md hover:bg-blue-500 disabled:opacity-30 disabled:cursor-not-allowed rounded-2xl font-bold transition-all shadow-xl shadow-blue-600/20 border border-white/10 whitespace-nowrap ${isCompactLayout ? 'px-3 py-2 text-sm' : 'px-4 py-3 text-base'}`}
                >
                  {gameState.currentBet > (user?.bet || 0) ? `Call $${gameState.currentBet - (user?.bet || 0)}` : 'Check'}
                </button>
              </div>

              <div className={`flex items-center justify-center bg-slate-900/78 backdrop-blur-xl border border-white/10 shadow-xl rounded-2xl ${isCompactLayout ? 'gap-1.5 px-1.5 py-1.5' : 'gap-2 px-2 py-2'}`}>
                <div className={`flex flex-col items-center ${isCompactLayout ? 'px-0.5' : 'px-1.5'}`}>
                  <span className={`${isCompactLayout ? 'text-[8px]' : 'text-[10px]'} font-bold text-slate-400 uppercase tracking-widest`}>Raise To</span>
                  <span className={`${isCompactLayout ? 'text-base' : 'text-xl'} font-mono font-bold text-yellow-400`}>${betAmount}</span>
                </div>
                <div className="flex gap-1 overflow-x-auto no-scrollbar">
                  {[5, 10, 50, 100].map(val => (
                    <button 
                      key={val}
                      disabled={!isUserTurn}
                      onClick={() => setBetAmount(prev => Math.min(user?.chips || 0, prev + val))}
                      className={`${isCompactLayout ? 'w-7 h-7 text-[10px]' : 'w-9 h-9 text-xs'} bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed rounded-xl flex items-center justify-center font-bold transition-colors flex-shrink-0`}
                    >
                      +{val}
                    </button>
                  ))}
                  <button 
                    disabled={!isUserTurn}
                    onClick={() => setBetAmount(gameState.currentBet + BIG_BLIND)}
                    className={`${isCompactLayout ? 'w-7 h-7 text-[10px]' : 'w-9 h-9 text-xs'} bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed rounded-xl flex items-center justify-center font-bold transition-colors flex-shrink-0`}
                    >
                      Min
                    </button>
                </div>
                <button 
                  disabled={!isUserTurn || betAmount <= gameState.currentBet}
                  onClick={() => handleAction('raise', betAmount)}
                  className={`bg-emerald-600/95 backdrop-blur-md hover:bg-emerald-500 disabled:opacity-30 disabled:cursor-not-allowed rounded-2xl font-bold transition-all shadow-xl shadow-emerald-600/20 border border-white/10 whitespace-nowrap ${isCompactLayout ? 'px-3 py-2 text-sm' : 'px-4 py-3 text-base'}`}
                >
                  Raise
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Background Decoration */}
      <div className="fixed inset-0 pointer-events-none -z-10 opacity-20">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-500 blur-[150px] rounded-full"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500 blur-[150px] rounded-full"></div>
      </div>
    </div>
  );
}
