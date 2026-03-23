export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  suit: Suit;
  rank: Rank;
}

export type HandPhase = 'waiting' | 'pre-flop' | 'flop' | 'turn' | 'river' | 'showdown';
export type RoomPreset = 'standard' | 'short' | 'custom';
export type HandRule = 'standard' | 'short';
export type PlayerAction = 'fold' | 'check' | 'call' | 'raise';

export interface RoomConfig {
  maxPlayers: number;
  preset: RoomPreset;
  removedRanks: Rank[];
  fillBots: boolean;
}

export interface ActionAvailability {
  check: boolean;
  call: boolean;
  raise: boolean;
  fold: boolean;
  toCall: number;
  minRaiseTo: number | null;
  maxRaiseTo: number | null;
}

export interface PlayerSeatSnapshot {
  id: string;
  name: string;
  seat: number;
  stack: number;
  bet: number;
  totalInvested: number;
  folded: boolean;
  allIn: boolean;
  inHand: boolean;
  isBot: boolean;
  connected: boolean;
  isHost: boolean;
  lastAction?: string;
  cards: Card[];
}

export interface ShowdownRowSnapshot {
  id: string;
  name: string;
  cards: Card[];
  text: string;
  winner: boolean;
}

export interface ShowdownSnapshot {
  winnerIds: string[];
  winnerNames: string;
  winningHand: string;
  pot: number;
  reason: string;
  rows: ShowdownRowSnapshot[];
}

export interface GameSnapshot {
  phase: HandPhase;
  communityCards: Card[];
  pot: number;
  currentBet: number;
  dealerSeat: number | null;
  turnSeat: number | null;
  variant: RoomPreset;
  handRule: HandRule;
  availableActions: ActionAvailability;
  showdown: ShowdownSnapshot | null;
}

export interface HandHistoryEntry {
  handNo: number;
  pot: number;
  winner: string;
  board: string;
  boardCards: Card[];
  cards: string;
  rows: ShowdownRowSnapshot[];
}

export interface RoomSnapshot {
  code: string;
  selfId: string;
  hostId: string;
  playerCount: number;
  humanCount: number;
  maxPlayers: number;
  handNo: number;
  config: RoomConfig;
  nextConfig: RoomConfig | null;
  players: PlayerSeatSnapshot[];
  game: GameSnapshot | null;
  history: HandHistoryEntry[];
}

export interface EnterRoomPayload {
  name: string;
  roomCode: string;
}

export interface EnterRoomResponse {
  playerToken: string;
  roomSnapshot: RoomSnapshot;
}

export interface ReconnectRoomPayload {
  playerToken: string;
}

export interface RoomConfigUpdatePayload {
  config: RoomConfig;
}

export interface GameActionPayload {
  action: PlayerAction;
  raiseTo?: number;
}

export const SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
export const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const CHIP_VALUES = [100, 50, 20, 10, 5];
export const INITIAL_STACK = 1000;
export const SMALL_BLIND = 10;
export const BIG_BLIND = 20;
export const SHORT_DECK_REMOVED_RANKS: Rank[] = ['2', '3', '4', '5'];
export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  maxPlayers: 6,
  preset: 'standard',
  removedRanks: [],
  fillBots: false,
};

export function normalizeRoomCode(roomCode: string): string {
  return roomCode.trim().replace(/\D/g, '').slice(0, 6);
}

export function clampPlayerCount(value: number): number {
  return Math.max(2, Math.min(6, Math.trunc(value)));
}

export function uniqueRanks(ranks: Rank[]): Rank[] {
  const chosen = new Set(ranks);
  return RANKS.filter((rank) => chosen.has(rank));
}

export function deriveRemovedRanks(preset: RoomPreset, removedRanks: Rank[]): Rank[] {
  if (preset === 'standard') return [];
  if (preset === 'short') return [...SHORT_DECK_REMOVED_RANKS];
  const unique = uniqueRanks(removedRanks);
  return unique.length > 0 ? unique : [...SHORT_DECK_REMOVED_RANKS];
}

export function normalizeRoomConfig(config: Partial<RoomConfig> | undefined): RoomConfig {
  const preset = config?.preset ?? DEFAULT_ROOM_CONFIG.preset;
  return {
    maxPlayers: clampPlayerCount(config?.maxPlayers ?? DEFAULT_ROOM_CONFIG.maxPlayers),
    preset,
    removedRanks: deriveRemovedRanks(preset, config?.removedRanks ?? DEFAULT_ROOM_CONFIG.removedRanks),
    fillBots: Boolean(config?.fillBots),
  };
}

export function resolveHandRule(config: RoomConfig): HandRule {
  return config.preset === 'standard' ? 'standard' : 'short';
}

export function createDeck(removedRanks: Rank[] = []): Card[] {
  const blocked = new Set(removedRanks);
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      if (!blocked.has(rank)) {
        deck.push({ suit, rank });
      }
    }
  }
  return shuffle(deck);
}

export function getRankValue(rank: Rank): number {
  return RANKS.indexOf(rank) + 2;
}

export function configLabel(config: RoomConfig): string {
  if (config.preset === 'standard') return 'Standard';
  if (config.preset === 'short') return 'Short Deck';
  return `Custom (${config.removedRanks.join(', ')})`;
}

function shuffle<T>(items: T[]): T[] {
  const clone = [...items];
  for (let index = clone.length - 1; index > 0; index -= 1) {
    const nextIndex = Math.floor(Math.random() * (index + 1));
    [clone[index], clone[nextIndex]] = [clone[nextIndex], clone[index]];
  }
  return clone;
}
