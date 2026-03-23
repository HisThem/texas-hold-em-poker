/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  suit: Suit;
  rank: Rank;
}

export type GamePhase = 'waiting' | 'pre-flop' | 'flop' | 'turn' | 'river' | 'showdown';

export interface Player {
  id: string;
  name: string;
  chips: number;
  bet: number;
  cards: Card[];
  isFolded: boolean;
  isAllIn: boolean;
  isDealer: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  lastAction?: string;
}

export interface GameState {
  players: Player[];
  communityCards: Card[];
  pot: number;
  phase: GamePhase;
  currentPlayerIndex: number;
  dealerIndex: number;
  smallBlind: number;
  bigBlind: number;
  currentBet: number;
  deck: Card[];
  winners: string[];
  winningHand?: string;
}

export const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];

export const CHIP_VALUES = [100, 50, 20, 10, 5];

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return shuffle(deck);
}

function shuffle<T>(array: T[]): T[] {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

export function getRankValue(rank: Rank): number {
  return RANKS.indexOf(rank) + 2;
}
