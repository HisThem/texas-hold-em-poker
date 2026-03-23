import React from 'react';
import { Suit, Rank } from '../types';

interface CardProps {
  suit?: Suit;
  rank?: Rank;
  hidden?: boolean;
  compact?: boolean;
  className?: string;
}

const SUIT_SYMBOLS: Record<Suit, string> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
};

const SUIT_COLORS: Record<Suit, string> = {
  hearts: 'text-red-600',
  diamonds: 'text-red-600',
  clubs: 'text-black',
  spades: 'text-black',
};

export const CardComponent: React.FC<CardProps> = ({ suit, rank, hidden, compact = false, className = "" }) => {
  const cardSizeClass = compact
    ? 'w-9 h-13 sm:w-12 sm:h-16 rounded-md'
    : 'w-12 h-16 sm:w-16 sm:h-24 rounded-lg';
  const paddingClass = compact ? 'p-1' : 'p-1 sm:p-2';
  const cornerTextClass = compact ? 'text-xs sm:text-sm' : 'text-sm sm:text-xl';
  const suitTextClass = compact ? 'text-lg sm:text-2xl bottom-1 right-1' : 'text-2xl sm:text-4xl bottom-1 right-1 sm:bottom-2 sm:right-2';

  if (hidden) {
    return (
      <div className={`${cardSizeClass} bg-blue-800 border-2 border-white shadow-lg flex items-center justify-center overflow-hidden relative ${className}`}>
        <div className="w-full h-full opacity-20 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white via-transparent to-transparent"></div>
        <div className={`absolute text-white/10 font-bold select-none ${compact ? 'text-3xl sm:text-4xl' : 'text-5xl'}`}>♠</div>
      </div>
    );
  }

  if (!suit || !rank) return null;

  return (
    <div className={`${cardSizeClass} bg-white border border-gray-300 shadow-md flex flex-col ${paddingClass} relative select-none ${className}`}>
      <div className={`${cornerTextClass} font-bold leading-none ${SUIT_COLORS[suit]}`}>
        {rank}
      </div>
      <div className={`${cornerTextClass} leading-none ${SUIT_COLORS[suit]}`}>
        {SUIT_SYMBOLS[suit]}
      </div>
      <div className={`absolute opacity-80 ${suitTextClass} ${SUIT_COLORS[suit]}`}>
        {SUIT_SYMBOLS[suit]}
      </div>
    </div>
  );
};
