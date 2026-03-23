import React from 'react';
import { Suit, Rank } from '../types';

interface CardProps {
  suit?: Suit;
  rank?: Rank;
  hidden?: boolean;
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

export const CardComponent: React.FC<CardProps> = ({ suit, rank, hidden, className = "" }) => {
  if (hidden) {
    return (
      <div className={`w-12 h-16 sm:w-16 sm:h-24 bg-blue-800 rounded-lg border-2 border-white shadow-lg flex items-center justify-center overflow-hidden ${className}`}>
        <div className="w-full h-full opacity-20 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white via-transparent to-transparent"></div>
        <div className="absolute text-white/10 text-4xl font-bold select-none">♠</div>
      </div>
    );
  }

  if (!suit || !rank) return null;

  return (
    <div className={`w-12 h-16 sm:w-16 sm:h-24 bg-white rounded-lg border border-gray-300 shadow-md flex flex-col p-1 sm:p-2 relative select-none ${className}`}>
      <div className={`text-xs sm:text-lg font-bold leading-none ${SUIT_COLORS[suit]}`}>
        {rank}
      </div>
      <div className={`text-xs sm:text-lg leading-none ${SUIT_COLORS[suit]}`}>
        {SUIT_SYMBOLS[suit]}
      </div>
      <div className={`absolute bottom-1 right-1 sm:bottom-2 sm:right-2 text-xl sm:text-3xl opacity-80 ${SUIT_COLORS[suit]}`}>
        {SUIT_SYMBOLS[suit]}
      </div>
    </div>
  );
};
