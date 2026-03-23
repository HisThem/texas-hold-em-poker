import { Card, getRankValue, Rank } from './types';

export enum HandRank {
  HighCard = 0,
  OnePair = 1,
  TwoPair = 2,
  ThreeOfAKind = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  FourOfAKind = 7,
  StraightFlush = 8,
  RoyalFlush = 9,
}

export interface HandResult {
  rank: HandRank;
  value: number; // For tie-breaking
  name: string;
  cards: Card[];
}

export function evaluateHand(cards: Card[]): HandResult {
  // Simplified evaluation for demonstration, but robust enough for standard play
  const sorted = [...cards].sort((a, b) => getRankValue(b.rank) - getRankValue(a.rank));
  
  const isFlush = checkFlush(sorted);
  const isStraight = checkStraight(sorted);
  
  if (isFlush && isStraight) {
    if (isStraight.cards[0].rank === 'A') return { rank: HandRank.RoyalFlush, value: 1000, name: 'Royal Flush', cards: isStraight.cards };
    return { rank: HandRank.StraightFlush, value: 900 + getRankValue(isStraight.cards[0].rank), name: 'Straight Flush', cards: isStraight.cards };
  }
  
  const counts = getCounts(sorted);
  const quads = Object.entries(counts).find(([_, count]) => count === 4);
  if (quads) return { rank: HandRank.FourOfAKind, value: 800 + getRankValue(quads[0] as Rank), name: 'Four of a Kind', cards: sorted.filter(c => c.rank === quads[0]).concat(sorted.filter(c => c.rank !== quads[0]).slice(0, 1)) };
  
  const trips = Object.entries(counts).filter(([_, count]) => count === 3);
  const pairs = Object.entries(counts).filter(([_, count]) => count === 2);
  
  if (trips.length > 0 && (trips.length > 1 || pairs.length > 0)) {
    const mainTrip = trips[0][0] as Rank;
    const secondPair = (trips.length > 1 ? trips[1][0] : pairs[0][0]) as Rank;
    return { rank: HandRank.FullHouse, value: 700 + getRankValue(mainTrip), name: 'Full House', cards: sorted.filter(c => c.rank === mainTrip || c.rank === secondPair) };
  }
  
  if (isFlush) return { rank: HandRank.Flush, value: 600 + getRankValue(isFlush.cards[0].rank), name: 'Flush', cards: isFlush.cards };
  if (isStraight) return { rank: HandRank.Straight, value: 500 + getRankValue(isStraight.cards[0].rank), name: 'Straight', cards: isStraight.cards };
  
  if (trips.length > 0) {
    const tripRank = trips[0][0] as Rank;
    return { rank: HandRank.ThreeOfAKind, value: 400 + getRankValue(tripRank), name: 'Three of a Kind', cards: sorted.filter(c => c.rank === tripRank).concat(sorted.filter(c => c.rank !== tripRank).slice(0, 2)) };
  }
  
  if (pairs.length >= 2) {
    const p1 = pairs[0][0] as Rank;
    const p2 = pairs[1][0] as Rank;
    return { rank: HandRank.TwoPair, value: 300 + getRankValue(p1) * 10 + getRankValue(p2), name: 'Two Pair', cards: sorted.filter(c => c.rank === p1 || c.rank === p2).concat(sorted.filter(c => c.rank !== p1 && c.rank !== p2).slice(0, 1)) };
  }
  
  if (pairs.length === 1) {
    const p = pairs[0][0] as Rank;
    return { rank: HandRank.OnePair, value: 200 + getRankValue(p), name: 'One Pair', cards: sorted.filter(c => c.rank === p).concat(sorted.filter(c => c.rank !== p).slice(0, 3)) };
  }
  
  return { rank: HandRank.HighCard, value: 100 + getRankValue(sorted[0].rank), name: 'High Card', cards: sorted.slice(0, 5) };
}

function getCounts(cards: Card[]): Record<string, number> {
  const counts: Record<string, number> = {};
  cards.forEach(c => counts[c.rank] = (counts[c.rank] || 0) + 1);
  return counts;
}

function checkFlush(cards: Card[]): { cards: Card[] } | null {
  const suits: Record<string, Card[]> = {};
  cards.forEach(c => {
    if (!suits[c.suit]) suits[c.suit] = [];
    suits[c.suit].push(c);
  });
  for (const s in suits) {
    if (suits[s].length >= 5) return { cards: suits[s].slice(0, 5) };
  }
  return null;
}

function checkStraight(cards: Card[]): { cards: Card[] } | null {
  const uniqueRanks = Array.from(new Set(cards.map(c => c.rank)));
  if (uniqueRanks.length < 5) return null;
  
  const values = uniqueRanks.map(getRankValue).sort((a, b) => b - a);
  
  // Check for Ace-low straight
  if (values.includes(14) && values.includes(2) && values.includes(3) && values.includes(4) && values.includes(5)) {
     const ace = cards.find(c => c.rank === 'A')!;
     const five = cards.find(c => c.rank === '5')!;
     const four = cards.find(c => c.rank === '4')!;
     const three = cards.find(c => c.rank === '3')!;
     const two = cards.find(c => c.rank === '2')!;
     return { cards: [five, four, three, two, ace] };
  }

  for (let i = 0; i <= values.length - 5; i++) {
    if (values[i] - values[i + 4] === 4) {
      const straightCards = values.slice(i, i + 5).map(v => cards.find(c => getRankValue(c.rank) === v)!);
      return { cards: straightCards };
    }
  }
  return null;
}
