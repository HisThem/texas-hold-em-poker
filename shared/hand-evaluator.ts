import { Card, getRankValue, HandRule, Rank } from './game';

const HAND_NAMES = {
  straightFlush: 'Straight Flush',
  fourOfAKind: 'Four of a Kind',
  fullHouse: 'Full House',
  flush: 'Flush',
  straight: 'Straight',
  threeOfAKind: 'Three of a Kind',
  twoPair: 'Two Pair',
  onePair: 'One Pair',
  highCard: 'High Card',
} as const;

type HandKind = keyof typeof HAND_NAMES;

export interface HandResult {
  kind: HandKind;
  name: string;
  cards: Card[];
  score: number[];
}

export function evaluateBestHand(cards: Card[], rule: HandRule): HandResult {
  if (cards.length < 5) {
    throw new Error('At least five cards are required to evaluate a hand.');
  }

  const combinations = choose(cards, 5);
  let best = evaluateFiveCardHand(combinations[0], rule);

  for (let index = 1; index < combinations.length; index += 1) {
    const candidate = evaluateFiveCardHand(combinations[index], rule);
    if (compareHandResults(candidate, best) > 0) {
      best = candidate;
    }
  }

  return best;
}

export function compareHandResults(left: HandResult, right: HandResult): number {
  return compareScore(left.score, right.score);
}

function evaluateFiveCardHand(cards: Card[], rule: HandRule): HandResult {
  const sorted = [...cards].sort((a, b) => getRankValue(b.rank) - getRankValue(a.rank));
  const values = sorted.map((card) => getRankValue(card.rank));
  const counts = new Map<number, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const isFlush = sorted.every((card) => card.suit === sorted[0].suit);
  const straightHigh = getStraightHigh(sorted.map((card) => card.rank), rule);
  const grouped = [...counts.entries()].sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return right[0] - left[0];
  });
  const pairs = grouped.filter((entry) => entry[1] === 2).map((entry) => entry[0]);
  const trips = grouped.filter((entry) => entry[1] === 3).map((entry) => entry[0]);
  const quads = grouped.find((entry) => entry[1] === 4)?.[0] ?? null;
  const flushRank = rule === 'standard' ? 5 : 6;
  const fullHouseRank = rule === 'standard' ? 6 : 5;

  if (isFlush && straightHigh !== null) {
    return makeResult('straightFlush', [8, straightHigh], sortStraightCards(sorted, straightHigh, rule));
  }

  if (quads !== null) {
    const kicker = grouped.find((entry) => entry[0] !== quads)![0];
    return makeResult('fourOfAKind', [7, quads, kicker], orderByCounts(sorted, [quads, kicker]));
  }

  if (trips.length && pairs.length) {
    return makeResult('fullHouse', [fullHouseRank, trips[0], pairs[0]], orderByCounts(sorted, [trips[0], pairs[0]]));
  }

  if (trips.length > 1) {
    return makeResult('fullHouse', [fullHouseRank, trips[0], trips[1]], orderByCounts(sorted, [trips[0], trips[1]]));
  }

  if (isFlush) {
    return makeResult('flush', [flushRank, ...values], sorted);
  }

  if (straightHigh !== null) {
    return makeResult('straight', [4, straightHigh], sortStraightCards(sorted, straightHigh, rule));
  }

  if (trips.length) {
    const kickers = grouped.filter((entry) => entry[0] !== trips[0]).map((entry) => entry[0]);
    return makeResult('threeOfAKind', [3, trips[0], ...kickers], orderByCounts(sorted, [trips[0], ...kickers]));
  }

  if (pairs.length >= 2) {
    const kicker = grouped.filter((entry) => !pairs.includes(entry[0]))[0][0];
    return makeResult('twoPair', [2, pairs[0], pairs[1], kicker], orderByCounts(sorted, [pairs[0], pairs[1], kicker]));
  }

  if (pairs.length === 1) {
    const kickers = grouped.filter((entry) => entry[0] !== pairs[0]).map((entry) => entry[0]);
    return makeResult('onePair', [1, pairs[0], ...kickers], orderByCounts(sorted, [pairs[0], ...kickers]));
  }

  return makeResult('highCard', [0, ...values], sorted);
}

function getStraightHigh(ranks: Rank[], rule: HandRule): number | null {
  const uniqueValues: number[] = Array.from(new Set<number>(ranks.map((rank) => getRankValue(rank)))).sort(
    (left, right) => right - left,
  );

  for (let index = 0; index <= uniqueValues.length - 5; index += 1) {
    const window = uniqueValues.slice(index, index + 5);
    if (window[0] - window[4] === 4) {
      return window[0];
    }
  }

  if (rule === 'standard') {
    const wheel = [14, 5, 4, 3, 2];
    if (wheel.every((value) => uniqueValues.includes(value))) {
      return 5;
    }
  } else {
    const shortWheel = [14, 9, 8, 7, 6];
    if (shortWheel.every((value) => uniqueValues.includes(value))) {
      return 9;
    }
  }

  return null;
}

function sortStraightCards(cards: Card[], straightHigh: number, rule: HandRule): Card[] {
  const neededValues =
    rule === 'standard' && straightHigh === 5
      ? [5, 4, 3, 2, 14]
      : rule === 'short' && straightHigh === 9 && cards.some((card) => card.rank === 'A')
        ? [9, 8, 7, 6, 14]
        : [straightHigh, straightHigh - 1, straightHigh - 2, straightHigh - 3, straightHigh - 4];

  return neededValues.map((value) => cards.find((card) => getRankValue(card.rank) === value)!);
}

function orderByCounts(cards: Card[], orderedValues: number[]): Card[] {
  const result: Card[] = [];
  const remaining = [...cards];

  for (const value of orderedValues) {
    const matches = remaining.filter((card) => getRankValue(card.rank) === value);
    for (const match of matches) {
      result.push(match);
      remaining.splice(remaining.indexOf(match), 1);
    }
  }

  return result;
}

function makeResult(kind: HandKind, score: number[], cards: Card[]): HandResult {
  return {
    kind,
    name: HAND_NAMES[kind],
    cards,
    score,
  };
}

function compareScore(left: number[], right: number[]): number {
  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function choose<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  if (items.length === size) return [[...items]];

  const [head, ...tail] = items;
  const withHead = choose(tail, size - 1).map((combo) => [head, ...combo]);
  const withoutHead = choose(tail, size);
  return [...withHead, ...withoutHead];
}
