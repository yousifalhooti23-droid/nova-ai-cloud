import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface NovaLogoProps extends HTMLAttributes<HTMLDivElement> {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'full' | 'icon';
  theme?: 'dark' | 'light' | 'auto';
  className?: string;
}

export function NovaLogo({
  size = 'md',
  variant = 'full',
  theme = 'auto',
  className,
  ...rest
}: NovaLogoProps) {
  const iconSizes = {
    sm: 'h-6 w-auto',
    md: 'h-8 w-auto',
    lg: 'h-12 w-auto',
    xl: 'h-16 w-auto',
  };

  const fullSizes = {
    sm: 'h-7 w-auto',
    md: 'h-9 w-auto',
    lg: 'h-14 w-auto',
    xl: 'h-20 w-auto',
  };

  return (
    <div
      className={cn('inline-flex items-center gap-2.5 select-none', className)}
      {...rest}
    >
      {/* Official NOVA Cloud + Lightning + Star Icon */}
      <img
        src="/nova-logo.png"
        alt="NOVA AI Cloud"
        className={cn(
          'object-contain transition-transform duration-200',
          variant === 'icon' ? iconSizes[size] : fullSizes[size],
        )}
        draggable={false}
      />

      {variant === 'full' && (
        <div className="flex flex-col text-start leading-none">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                'font-extrabold tracking-tight',
                size === 'sm' && 'text-[15px]',
                size === 'md' && 'text-[18px]',
                size === 'lg' && 'text-[24px]',
                size === 'xl' && 'text-[32px]',
                theme === 'dark'
                  ? 'text-white'
                  : theme === 'light'
                    ? 'text-[#071A3D]'
                    : 'text-text',
              )}
            >
              Nova
            </span>
            <span className="rounded-[4px] bg-[#1769FF] px-1 py-0.2 font-mono text-[9px] font-bold uppercase tracking-wider text-white">
              Cloud
            </span>
          </div>
          <span
            className={cn(
              'font-mono uppercase tracking-[0.2em] font-medium text-dim mt-0.5',
              size === 'sm' && 'text-[8.5px]',
              size === 'md' && 'text-[9.5px]',
              size === 'lg' && 'text-[11px]',
              size === 'xl' && 'text-[13px]',
            )}
          >
            Universal AI
          </span>
        </div>
      )}
    </div>
  );
}
