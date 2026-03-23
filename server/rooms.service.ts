import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { compareHandResults, evaluateBestHand } from '../shared/hand-evaluator';
import {
  ActionAvailability,
  BIG_BLIND,
  Card,
  configLabel,
  createDeck,
  DEFAULT_ROOM_CONFIG,
  EnterRoomPayload,
  EnterRoomResponse,
  GameActionPayload,
  GameSnapshot,
  HandHistoryEntry,
  HandPhase,
  INITIAL_STACK,
  normalizeRoomCode,
  normalizeRoomConfig,
  PlayerSeatSnapshot,
  resolveHandRule,
  RoomConfig,
  RoomPreset,
  RoomSnapshot,
  SMALL_BLIND,
} from '../shared/game';
import { DatabaseService } from './database.service';

interface InternalPlayer {
  id: string;
  token?: string;
  name: string;
  seat: number;
  stack: number;
  bet: number;
  totalInvested: number;
  cards: Card[];
  folded: boolean;
  allIn: boolean;
  inHand: boolean;
  isBot: boolean;
  connected: boolean;
  lastAction?: string;
  socketId?: string;
  hasActed: boolean;
}

interface InternalGame {
  phase: HandPhase;
  deck: Card[];
  communityCards: Card[];
  pot: number;
  currentBet: number;
  dealerSeat: number | null;
  smallBlindSeat: number | null;
  bigBlindSeat: number | null;
  turnSeat: number | null;
  variant: RoomPreset;
  showdown: GameSnapshot['showdown'];
}

interface RoomState {
  code: string;
  hostId: string;
  config: RoomConfig;
  nextConfig: RoomConfig | null;
  handNo: number;
  dealerSeat: number | null;
  players: InternalPlayer[];
  game: InternalGame | null;
  history: HandHistoryEntry[];
  botTimer: NodeJS.Timeout | null;
}

interface BroadcastPacket {
  socketId: string;
  event: string;
  data: unknown;
}

@Injectable()
export class RoomsService {
  private readonly rooms = new Map<string, RoomState>();
  private readonly socketToToken = new Map<string, string>();
  private broadcaster: ((packets: BroadcastPacket[]) => void) | null = null;

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  attachBroadcaster(broadcaster: (packets: BroadcastPacket[]) => void) {
    this.broadcaster = broadcaster;
  }

  enterRoom(payload: EnterRoomPayload): EnterRoomResponse {
    const name = payload.name?.trim().slice(0, 18);
    const roomCode = normalizeRoomCode(payload.roomCode ?? '');

    if (!name) throw new Error('Please enter your name.');
    if (!/^\d{6}$/.test(roomCode)) throw new Error('Room code must be 6 digits.');

    const room = this.rooms.get(roomCode) ?? this.createRoom(roomCode);
    if (room.players.length >= room.config.maxPlayers) {
      throw new Error('This room is full.');
    }

    const playerId = `p_${randomUUID()}`;
    const playerToken = randomUUID();
    const player: InternalPlayer = {
      id: playerId,
      token: playerToken,
      name,
      seat: this.findOpenSeat(room),
      stack: INITIAL_STACK,
      bet: 0,
      totalInvested: 0,
      cards: [],
      folded: false,
      allIn: false,
      inHand: false,
      isBot: false,
      connected: false,
      hasActed: false,
    };

    room.players.push(player);
    if (!room.hostId) {
      room.hostId = player.id;
    }

    this.persistRoom(room);
    const roomSnapshot = this.buildRoomSnapshot(room, player.id);
    return { playerToken, roomSnapshot };
  }

  reconnect(playerToken: string): EnterRoomResponse {
    if (!playerToken) throw new Error('Missing player token.');

    const direct = this.findPlayerByToken(playerToken);
    if (direct) {
      return {
        playerToken,
        roomSnapshot: this.buildRoomSnapshot(direct.room, direct.player.id),
      };
    }

    const session = this.database.findSession(playerToken);
    if (!session) throw new Error('Session not found.');

    const room = this.rooms.get(session.roomCode);
    if (!room) throw new Error('Room is no longer available.');

    const player = room.players.find((entry) => entry.id === session.playerId && entry.token === playerToken);
    if (!player) throw new Error('Player is no longer seated in this room.');

    return {
      playerToken,
      roomSnapshot: this.buildRoomSnapshot(room, player.id),
    };
  }

  attachSocket(playerToken: string, socketId: string) {
    const found = this.findPlayerByToken(playerToken);
    if (!found) throw new Error('Unable to bind socket to room session.');

    found.player.connected = true;
    found.player.socketId = socketId;
    this.socketToToken.set(socketId, playerToken);
    this.database.saveSession(playerToken, found.player.id, found.room.code, found.player.seat);
    this.persistRoom(found.room);
    this.publishRoom(found.room, true);
  }

  handleDisconnect(socketId: string) {
    const token = this.socketToToken.get(socketId);
    if (!token) return;

    this.socketToToken.delete(socketId);
    const found = this.findPlayerByToken(token);
    if (!found) return;

    found.player.connected = false;
    found.player.socketId = undefined;
    this.persistRoom(found.room);
    this.publishRoom(found.room, false);
  }

  leaveBySocket(socketId: string) {
    const found = this.findPlayerBySocket(socketId);
    if (!found) throw new Error('Player session not found.');

    this.removePlayer(found.room, found.player);
    this.socketToToken.delete(socketId);
    if (found.player.token) {
      this.database.deleteSession(found.player.token);
    }
  }

  updateConfigBySocket(socketId: string, config: RoomConfig) {
    const found = this.findPlayerBySocket(socketId);
    if (!found) throw new Error('Player session not found.');
    this.assertHost(found.room, found.player);

    const nextConfig = normalizeRoomConfig(config);
    if (found.room.players.length > nextConfig.maxPlayers) {
      throw new Error('Reduce occupied seats before shrinking max players.');
    }

    if (this.isHandActive(found.room)) {
      found.room.nextConfig = nextConfig;
    } else {
      found.room.config = nextConfig;
      found.room.nextConfig = null;
      this.trimBotsIfNeeded(found.room);
    }

    this.persistRoom(found.room);
    this.publishRoom(found.room, true);
  }

  addBotBySocket(socketId: string, seat: number) {
    const found = this.findPlayerBySocket(socketId);
    if (!found) throw new Error('Player session not found.');
    this.assertHost(found.room, found.player);
    if (this.isHandActive(found.room)) {
      throw new Error('Bots can only be changed between hands.');
    }
    const targetSeat = Math.trunc(seat);
    if (targetSeat < 0 || targetSeat >= found.room.config.maxPlayers) {
      throw new Error('Seat is out of range.');
    }
    if (found.room.players.some((player) => player.seat === targetSeat)) {
      throw new Error('Seat is already occupied.');
    }

    const botId = `bot_${randomUUID()}`;
    found.room.players.push({
      id: botId,
      name: `Bot ${found.room.players.filter((player) => player.isBot).length + 1}`,
      seat: targetSeat,
      stack: INITIAL_STACK,
      bet: 0,
      totalInvested: 0,
      cards: [],
      folded: false,
      allIn: false,
      inHand: false,
      isBot: true,
      connected: true,
      hasActed: false,
    });

    this.persistRoom(found.room);
    this.publishRoom(found.room, true);
  }

  removeBotBySocket(socketId: string, playerId: string) {
    const found = this.findPlayerBySocket(socketId);
    if (!found) throw new Error('Player session not found.');
    this.assertHost(found.room, found.player);
    if (this.isHandActive(found.room)) {
      throw new Error('Bots can only be changed between hands.');
    }

    const bot = found.room.players.find((player) => player.id === playerId && player.isBot);
    if (!bot) throw new Error('Bot not found.');
    this.removePlayer(found.room, bot);
  }

  startGameBySocket(socketId: string) {
    const found = this.findPlayerBySocket(socketId);
    if (!found) throw new Error('Player session not found.');
    this.assertHost(found.room, found.player);

    if (this.isHandActive(found.room)) {
      throw new Error('A hand is already in progress.');
    }

    if (found.room.nextConfig) {
      found.room.config = found.room.nextConfig;
      found.room.nextConfig = null;
      this.trimBotsIfNeeded(found.room);
    }

    const participants = this.getPlayablePlayers(found.room);
    if (participants.length < 2) {
      throw new Error('At least two active seats are required to start.');
    }

    const deck = createDeck(found.room.config.removedRanks);
    const dealerSeat = this.getNextEligibleSeat(
      participants.map((player) => player.seat),
      found.room.dealerSeat,
    );
    found.room.dealerSeat = dealerSeat;
    found.room.handNo += 1;

    for (const player of found.room.players) {
      player.bet = 0;
      player.totalInvested = 0;
      player.cards = [];
      player.folded = false;
      player.allIn = false;
      player.inHand = participants.some((entry) => entry.id === player.id);
      player.lastAction = undefined;
      player.hasActed = false;
    }

    for (const player of participants) {
      player.cards = [deck.pop()!, deck.pop()!];
    }

    const smallBlindSeat =
      participants.length === 2
        ? dealerSeat
        : this.getNextEligibleSeat(participants.map((player) => player.seat), dealerSeat);
    const bigBlindSeat = this.getNextEligibleSeat(participants.map((player) => player.seat), smallBlindSeat);
    const firstTurnSeat =
      participants.length === 2
        ? dealerSeat
        : this.getNextEligibleSeat(participants.map((player) => player.seat), bigBlindSeat);

    found.room.game = {
      phase: 'pre-flop',
      deck,
      communityCards: [],
      pot: 0,
      currentBet: 0,
      dealerSeat,
      smallBlindSeat,
      bigBlindSeat,
      turnSeat: firstTurnSeat,
      variant: found.room.config.preset,
      showdown: null,
    };

    this.postBlind(found.room, smallBlindSeat, SMALL_BLIND, 'SB');
    this.postBlind(found.room, bigBlindSeat, BIG_BLIND, 'BB');
    found.room.game.currentBet = BIG_BLIND;

    this.persistRoom(found.room);
    this.publishRoom(found.room, true);
    this.scheduleBotTurn(found.room);
  }

  playerActionBySocket(socketId: string, payload: GameActionPayload) {
    const found = this.findPlayerBySocket(socketId);
    if (!found) throw new Error('Player session not found.');

    this.applyAction(found.room, found.player, payload);
    this.persistRoom(found.room);
    this.publishRoom(found.room, true);
    this.scheduleBotTurn(found.room);
  }

  private applyAction(room: RoomState, player: InternalPlayer, payload: GameActionPayload) {
    const game = room.game;
    if (!game || game.phase === 'waiting' || game.phase === 'showdown') {
      throw new Error('No active hand.');
    }
    if (game.turnSeat !== player.seat) {
      throw new Error('It is not your turn.');
    }

    const availability = this.getAvailableActions(room, player.id);
    if (payload.action === 'fold') {
      if (!availability.fold) throw new Error('Fold is not available.');
      player.folded = true;
      player.hasActed = true;
      player.lastAction = 'Fold';
    } else if (payload.action === 'check') {
      if (!availability.check) throw new Error('Check is not available.');
      player.hasActed = true;
      player.lastAction = 'Check';
    } else if (payload.action === 'call') {
      if (!availability.call && !availability.check) throw new Error('Call is not available.');
      const toCall = Math.max(0, game.currentBet - player.bet);
      const contribution = Math.min(player.stack, toCall);
      player.stack -= contribution;
      player.bet += contribution;
      player.totalInvested += contribution;
      player.allIn = player.stack === 0;
      player.hasActed = true;
      player.lastAction = toCall === 0 ? 'Check' : 'Call';
    } else if (payload.action === 'raise') {
      if (!availability.raise || availability.minRaiseTo === null || availability.maxRaiseTo === null) {
        throw new Error('Raise is not available.');
      }
      const raiseTo = payload.raiseTo ?? availability.minRaiseTo;
      if (raiseTo < availability.minRaiseTo || raiseTo > availability.maxRaiseTo) {
        throw new Error('Raise size is out of range.');
      }
      const contribution = raiseTo - player.bet;
      player.stack -= contribution;
      player.bet = raiseTo;
      player.totalInvested += contribution;
      player.allIn = player.stack === 0;
      player.hasActed = true;
      player.lastAction = `Raise ${raiseTo}`;
      game.currentBet = raiseTo;

      for (const other of room.players) {
        if (other.id !== player.id && other.inHand && !other.folded && !other.allIn) {
          other.hasActed = false;
        }
      }
    }

    this.resolveAfterAction(room, player.seat);
  }

  private resolveAfterAction(room: RoomState, currentSeat: number) {
    const game = room.game;
    if (!game) return;

    const contenders = room.players.filter((player) => player.inHand && !player.folded);
    if (contenders.length === 1) {
      this.finishByFold(room, contenders[0]);
      return;
    }

    const actors = contenders.filter((player) => !player.allIn);
    if (actors.length === 0) {
      this.runOutAndShowdown(room, 'All remaining players are all-in.');
      return;
    }

    const everyoneActed = actors.every((player) => player.hasActed);
    const everyoneMatched = contenders.every((player) => player.allIn || player.bet === game.currentBet);
    if (everyoneActed && everyoneMatched) {
      if (contenders.some((player) => player.allIn)) {
        this.runOutAndShowdown(room, 'All-in runout.');
        return;
      }

      if (game.phase === 'river') {
        this.resolveShowdown(room, 'River complete.');
        return;
      }

      this.advancePhase(room);
      return;
    }

    game.turnSeat = this.getNextEligibleSeat(
      actors.map((player) => player.seat),
      currentSeat,
    );
  }

  private advancePhase(room: RoomState) {
    const game = room.game;
    if (!game) return;

    this.collectBets(room);
    for (const player of room.players) {
      if (player.inHand && !player.folded) {
        player.hasActed = false;
        player.lastAction = undefined;
      }
    }

    if (game.phase === 'pre-flop') {
      game.phase = 'flop';
      game.communityCards.push(game.deck.pop()!, game.deck.pop()!, game.deck.pop()!);
    } else if (game.phase === 'flop') {
      game.phase = 'turn';
      game.communityCards.push(game.deck.pop()!);
    } else if (game.phase === 'turn') {
      game.phase = 'river';
      game.communityCards.push(game.deck.pop()!);
    }

    game.currentBet = 0;
    const nextActors = room.players.filter((player) => player.inHand && !player.folded && !player.allIn);
    if (nextActors.length === 0) {
      this.runOutAndShowdown(room, 'No further betting is possible.');
      return;
    }
    game.turnSeat = this.getNextEligibleSeat(
      nextActors.map((player) => player.seat),
      game.dealerSeat,
    );
  }

  private runOutAndShowdown(room: RoomState, reason: string) {
    const game = room.game;
    if (!game) return;

    this.collectBets(room);
    while (game.communityCards.length < 5) {
      game.communityCards.push(game.deck.pop()!);
    }
    this.resolveShowdown(room, reason);
  }

  private resolveShowdown(room: RoomState, reason: string) {
    const game = room.game;
    if (!game) return;

    this.collectBets(room);
    const contenders = room.players.filter((player) => player.inHand && !player.folded);
    const handRule = resolveHandRule(room.config);
    const results = contenders.map((player) => ({
      player,
      hand: evaluateBestHand([...player.cards, ...game.communityCards], handRule),
    }));
    results.sort((left, right) => compareHandResults(right.hand, left.hand));
    const best = results[0].hand;
    const winners = results.filter((result) => compareHandResults(result.hand, best) === 0);
    const totalPot = game.pot;
    const perWinner = Math.floor(totalPot / winners.length);
    let remainder = totalPot % winners.length;

    for (const { player } of winners) {
      player.stack += perWinner + (remainder > 0 ? 1 : 0);
      remainder = Math.max(0, remainder - 1);
    }

    const rows = results.map((result) => ({
      id: result.player.id,
      name: result.player.name,
      cards: result.player.cards,
      text: result.player.folded ? 'Folded' : result.hand.name,
      winner: winners.some((winner) => winner.player.id === result.player.id),
    }));

    const historyEntry: HandHistoryEntry = {
      handNo: room.handNo,
      pot: totalPot,
      winner: winners.map((winner) => winner.player.name).join(', '),
      board: this.formatCards(game.communityCards),
      boardCards: [...game.communityCards],
      cards: best.name,
      rows,
    };

    room.history = [historyEntry, ...room.history].slice(0, 12);
    this.database.saveHandHistory(room.code, historyEntry);

    game.phase = 'showdown';
    game.turnSeat = null;
    game.currentBet = 0;
    game.showdown = {
      winnerIds: winners.map((winner) => winner.player.id),
      winnerNames: winners.map((winner) => winner.player.name).join(', '),
      winningHand: best.name,
      pot: totalPot,
      reason,
      rows,
    };
  }

  private finishByFold(room: RoomState, winner: InternalPlayer) {
    const game = room.game;
    if (!game) return;

    this.collectBets(room);
    winner.stack += game.pot;
    const totalPot = game.pot;
    const rows = room.players
      .filter((player) => player.inHand)
      .map((player) => ({
        id: player.id,
        name: player.name,
        cards: player.cards,
        text: player.id === winner.id ? 'Last player standing' : 'Folded',
        winner: player.id === winner.id,
      }));

    const historyEntry: HandHistoryEntry = {
      handNo: room.handNo,
      pot: totalPot,
      winner: winner.name,
      board: this.formatCards(game.communityCards),
      boardCards: [...game.communityCards],
      cards: 'Fold win',
      rows,
    };

    room.history = [historyEntry, ...room.history].slice(0, 12);
    this.database.saveHandHistory(room.code, historyEntry);

    game.phase = 'showdown';
    game.turnSeat = null;
    game.currentBet = 0;
    game.showdown = {
      winnerIds: [winner.id],
      winnerNames: winner.name,
      winningHand: 'Fold win',
      pot: totalPot,
      reason: `${winner.name} wins after everyone else folded.`,
      rows,
    };
  }

  private collectBets(room: RoomState) {
    const game = room.game;
    if (!game) return;

    for (const player of room.players) {
      game.pot += player.bet;
      player.bet = 0;
    }
  }

  private postBlind(room: RoomState, seat: number | null, amount: number, label: string) {
    if (seat === null) return;
    const player = room.players.find((entry) => entry.seat === seat);
    if (!player) return;
    const contribution = Math.min(player.stack, amount);
    player.stack -= contribution;
    player.bet += contribution;
    player.totalInvested += contribution;
    player.allIn = player.stack === 0;
    player.lastAction = label;
  }

  private removePlayer(room: RoomState, player: InternalPlayer) {
    if (room.game && player.inHand) {
      player.folded = true;
      room.game.turnSeat = room.game.turnSeat === player.seat ? this.findNextTurnSeat(room, player.seat) : room.game.turnSeat;
      this.collectPlayerBet(room, player);
    }

    room.players = room.players.filter((entry) => entry.id !== player.id);
    this.database.saveMembership(room.code, player.id, player.seat, false);

    const remainingHumans = room.players.filter((entry) => !entry.isBot);
    if (remainingHumans.length === 0) {
      this.clearRoom(room.code);
      return;
    }

    if (room.hostId === player.id) {
      room.hostId = this.getNextHumanHost(room, player.seat)?.id ?? '';
    }

    if (room.players.length === 0) {
      this.clearRoom(room.code);
      return;
    }

    if (room.game && room.game.phase !== 'showdown') {
      const contenders = room.players.filter((entry) => entry.inHand && !entry.folded);
      if (contenders.length <= 1 && contenders[0]) {
        this.finishByFold(room, contenders[0]);
      }
    }

    this.persistRoom(room);
    this.publishRoom(room, true);
  }

  private getNextHumanHost(room: RoomState, currentSeat: number): InternalPlayer | null {
    const humans = room.players
      .filter((player) => !player.isBot)
      .sort((left, right) => left.seat - right.seat);
    if (humans.length === 0) return null;
    return humans.find((player) => player.seat > currentSeat) ?? humans[0];
  }

  private clearRoom(roomCode: string) {
    const room = this.rooms.get(roomCode);
    if (room?.botTimer) clearTimeout(room.botTimer);
    this.rooms.delete(roomCode);
  }

  private collectPlayerBet(room: RoomState, player: InternalPlayer) {
    if (!room.game) return;
    room.game.pot += player.bet;
    player.bet = 0;
  }

  private findNextTurnSeat(room: RoomState, currentSeat: number): number | null {
    const eligible = room.players.filter((player) => player.inHand && !player.folded && !player.allIn);
    if (eligible.length === 0) return null;
    return this.getNextEligibleSeat(
      eligible.map((player) => player.seat),
      currentSeat,
    );
  }

  private getAvailableActions(room: RoomState, playerId: string): ActionAvailability {
    const game = room.game;
    const player = room.players.find((entry) => entry.id === playerId);
    if (!game || !player || game.phase === 'showdown' || !player.inHand || player.folded || player.allIn || game.turnSeat !== player.seat) {
      return {
        check: false,
        call: false,
        raise: false,
        fold: false,
        toCall: 0,
        minRaiseTo: null,
        maxRaiseTo: null,
      };
    }

    const toCall = Math.max(0, game.currentBet - player.bet);
    const maxRaiseTo = player.stack + player.bet;
    const minRaiseTo = game.currentBet === 0 ? Math.min(maxRaiseTo, BIG_BLIND) : Math.min(maxRaiseTo, game.currentBet + BIG_BLIND);
    const canRaise = player.stack > toCall && minRaiseTo <= maxRaiseTo && maxRaiseTo > game.currentBet;

    return {
      check: toCall === 0,
      call: player.stack > 0,
      raise: canRaise,
      fold: true,
      toCall,
      minRaiseTo: canRaise ? minRaiseTo : null,
      maxRaiseTo: canRaise ? maxRaiseTo : null,
    };
  }

  private publishRoom(room: RoomState, includeShowdownEvent: boolean) {
    if (!this.broadcaster) return;

    const packets: BroadcastPacket[] = [];
    for (const player of room.players) {
      if (!player.socketId) continue;
      const snapshot = this.buildRoomSnapshot(room, player.id);
      packets.push({
        socketId: player.socketId,
        event: 'room:snapshot',
        data: snapshot,
      });
      if (includeShowdownEvent && snapshot.game?.phase === 'showdown' && snapshot.game.showdown) {
        packets.push({
          socketId: player.socketId,
          event: 'game:showdown',
          data: snapshot.game.showdown,
        });
      }
    }

    this.broadcaster(packets);
  }

  private buildRoomSnapshot(room: RoomState, viewerId: string): RoomSnapshot {
    const viewer = room.players.find((player) => player.id === viewerId);
    if (!viewer) throw new Error('Unable to build room snapshot.');

    return {
      code: room.code,
      selfId: viewer.id,
      hostId: room.hostId,
      playerCount: room.players.length,
      humanCount: room.players.filter((player) => !player.isBot).length,
      maxPlayers: room.config.maxPlayers,
      handNo: room.handNo,
      config: { ...room.config, removedRanks: [...room.config.removedRanks] },
      nextConfig: room.nextConfig ? { ...room.nextConfig, removedRanks: [...room.nextConfig.removedRanks] } : null,
      players: room.players
        .slice()
        .sort((left, right) => left.seat - right.seat)
        .map((player) => this.buildPlayerSnapshot(room, viewer, player)),
      game: room.game ? this.buildGameSnapshot(room, viewer.id) : null,
      history: room.history.map((entry) => ({
        ...entry,
        boardCards: [...entry.boardCards],
        rows: entry.rows.map((row: HandHistoryEntry['rows'][number]) => ({ ...row, cards: [...row.cards] })),
      })),
    };
  }

  private buildGameSnapshot(room: RoomState, viewerId: string): GameSnapshot {
    const game = room.game!;
    return {
      phase: game.phase,
      communityCards: [...game.communityCards],
      pot: game.pot,
      currentBet: game.currentBet,
      dealerSeat: game.dealerSeat,
      turnSeat: game.turnSeat,
      variant: game.variant,
      handRule: resolveHandRule(room.config),
      availableActions: this.getAvailableActions(room, viewerId),
      showdown: game.showdown
        ? {
            ...game.showdown,
            rows: game.showdown.rows.map((row: NonNullable<GameSnapshot['showdown']>['rows'][number]) => ({ ...row, cards: [...row.cards] })),
          }
        : null,
    };
  }

  private buildPlayerSnapshot(room: RoomState, viewer: InternalPlayer, player: InternalPlayer): PlayerSeatSnapshot {
    const revealCards = player.id === viewer.id || room.game?.phase === 'showdown';
    return {
      id: player.id,
      name: player.name,
      seat: player.seat,
      stack: player.stack,
      bet: player.bet,
      totalInvested: player.totalInvested,
      folded: player.folded,
      allIn: player.allIn,
      inHand: player.inHand,
      isBot: player.isBot,
      connected: player.connected,
      isHost: player.id === room.hostId,
      lastAction: player.lastAction,
      cards: revealCards ? [...player.cards] : [],
    };
  }

  private scheduleBotTurn(room: RoomState) {
    if (room.botTimer) {
      clearTimeout(room.botTimer);
      room.botTimer = null;
    }

    const game = room.game;
    if (!game || game.phase === 'showdown' || game.turnSeat === null) return;
    const actor = room.players.find((player) => player.seat === game.turnSeat);
    if (!actor || !actor.isBot) return;

    room.botTimer = setTimeout(() => {
      try {
        const action = this.pickBotAction(room, actor);
        this.applyAction(room, actor, action);
        this.persistRoom(room);
        this.publishRoom(room, true);
        this.scheduleBotTurn(room);
      } catch {
        room.botTimer = null;
      }
    }, 900);
  }

  private pickBotAction(room: RoomState, player: InternalPlayer): GameActionPayload {
    const availability = this.getAvailableActions(room, player.id);
    if (availability.raise && Math.random() > 0.7 && availability.minRaiseTo !== null) {
      const upper = availability.maxRaiseTo ?? availability.minRaiseTo;
      const target = Math.min(upper, availability.minRaiseTo + BIG_BLIND * Math.floor(Math.random() * 3));
      return { action: 'raise', raiseTo: target };
    }
    if (availability.check) return { action: 'check' };
    if (availability.toCall > player.stack * 0.65 && Math.random() > 0.5) return { action: 'fold' };
    return { action: 'call' };
  }

  private createRoom(roomCode: string): RoomState {
    const room: RoomState = {
      code: roomCode,
      hostId: '',
      config: { ...DEFAULT_ROOM_CONFIG },
      nextConfig: null,
      handNo: 0,
      dealerSeat: null,
      players: [],
      game: null,
      history: [],
      botTimer: null,
    };
    this.rooms.set(roomCode, room);
    return room;
  }

  private persistRoom(room: RoomState) {
    this.database.saveRoom(room.code, room.hostId, room.config, room.nextConfig, room.handNo);
    for (const player of room.players) {
      this.database.savePlayer(player.id, player.name, player.isBot);
      this.database.saveMembership(room.code, player.id, player.seat, true);
      if (player.token) {
        this.database.saveSession(player.token, player.id, room.code, player.seat);
      }
    }
  }

  private trimBotsIfNeeded(room: RoomState) {
    while (room.players.length > room.config.maxPlayers) {
      const bot = [...room.players].reverse().find((player) => player.isBot);
      if (!bot) break;
      room.players = room.players.filter((player) => player.id !== bot.id);
    }
  }

  private getPlayablePlayers(room: RoomState): InternalPlayer[] {
    return room.players.filter((player) => (player.isBot || player.connected) && player.stack > 0);
  }

  private findOpenSeat(room: RoomState): number {
    for (let seat = 0; seat < room.config.maxPlayers; seat += 1) {
      if (!room.players.some((player) => player.seat === seat)) {
        return seat;
      }
    }
    throw new Error('No seat available.');
  }

  private getNextEligibleSeat(seats: number[], currentSeat: number | null): number {
    const ordered = [...new Set(seats)].sort((left, right) => left - right);
    if (ordered.length === 0) throw new Error('No eligible seats.');
    if (currentSeat === null) return ordered[0];
    const next = ordered.find((seat) => seat > currentSeat);
    return next ?? ordered[0];
  }

  private findPlayerByToken(token: string): { room: RoomState; player: InternalPlayer } | null {
    for (const room of this.rooms.values()) {
      const player = room.players.find((entry) => entry.token === token);
      if (player) return { room, player };
    }
    return null;
  }

  private findPlayerBySocket(socketId: string): { room: RoomState; player: InternalPlayer } | null {
    const token = this.socketToToken.get(socketId);
    if (!token) return null;
    return this.findPlayerByToken(token);
  }

  private assertHost(room: RoomState, player: InternalPlayer) {
    if (room.hostId !== player.id) {
      throw new Error('Only the host can change this room.');
    }
  }

  private isHandActive(room: RoomState): boolean {
    return Boolean(room.game && room.game.phase !== 'showdown');
  }

  private formatCards(cards: Card[]): string {
    const suitMap: Record<Card['suit'], string> = {
      hearts: 'H',
      diamonds: 'D',
      clubs: 'C',
      spades: 'S',
    };
    return cards.map((card) => `${card.rank}${suitMap[card.suit]}`).join(' ');
  }
}
