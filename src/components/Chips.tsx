import React from 'react';
import { motion } from 'motion/react';
import { CHIP_VALUES } from '../types';

interface ChipProps {
  value: number;
  showValue?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

const CHIP_COLORS: Record<number, string> = {
  5: 'bg-red-500 border-red-800',
  10: 'bg-blue-500 border-blue-800',
  20: 'bg-green-500 border-green-800',
  50: 'bg-purple-500 border-purple-800',
  100: 'bg-black border-slate-900',
};

export const Chip: React.FC<ChipProps> = ({ value, showValue = true, className = "", style }) => {
  return (
    <div 
      className={`w-8 h-8 rounded-full border-[3px] flex items-center justify-center font-bold text-white shadow-md ring-1 ring-black/20 transition-transform ${CHIP_COLORS[value] || 'bg-gray-500 border-gray-700'} ${className}`}
      style={{
        ...style,
        boxShadow: '0 3px 0 rgba(0,0,0,0.6)', // Thicker side of the chip
        fontSize: value >= 100 ? '8px' : '10px'
      }}
    >
      <div className="absolute inset-0 rounded-full border border-dashed border-white/30 pointer-events-none"></div>
      {showValue && <span className="drop-shadow-md leading-none select-none">{value}</span>}
    </div>
  );
};

interface ChipStackProps {
  amount: number;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}

export const ChipStack: React.FC<ChipStackProps> = ({ amount, orientation = 'horizontal', className = "" }) => {
  if (amount <= 0) return null;

  // Breakdown amount into stacks of same denominations
  const stacks: { value: number; count: number }[] = [];
  let remaining = amount;

  for (const val of CHIP_VALUES) {
    const count = Math.floor(remaining / val);
    if (count > 0) {
      stacks.push({ value: val, count });
    }
    remaining %= val;
  }

  return (
    <div className={`flex ${orientation === 'horizontal' ? 'flex-row gap-1' : 'flex-col -space-y-5'} items-center justify-center relative ${className}`}>
      {stacks.map((stack, stackIdx) => (
        <div key={stackIdx} className="relative w-8 h-10">
          {Array.from({ length: Math.min(stack.count, 8) }).map((_, i) => (
            <motion.div
              key={i}
              initial={{ y: -100, opacity: 0, rotateX: 45 }}
              animate={{ y: 0, opacity: 1, rotateX: 0 }}
              transition={{ 
                type: 'spring', 
                damping: 12, 
                stiffness: 200, 
                delay: (stackIdx * 0.04) + (i * 0.02) 
              }}
              className="absolute left-0"
              style={{ 
                bottom: `${i * 3}px`,
                zIndex: i + (stackIdx * 10)
              }}
            >
              <Chip 
                value={stack.value} 
                showValue={i === Math.min(stack.count, 8) - 1} // Only show value on the top chip
              />
            </motion.div>
          ))}
          {stack.count > 8 && (
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-[8px] font-bold text-yellow-400 z-50">
              +{stack.count - 8}
            </div>
          )}
        </div>
      ))}
      {/* Value Label - Positioned to the right of the entire stack group */}
      <div className="absolute left-full ml-2 text-[10px] font-bold text-white bg-black/70 px-2 py-0.5 rounded-full whitespace-nowrap border border-white/10 shadow-xl z-[100]">
        ${amount}
      </div>
    </div>
  );
};
