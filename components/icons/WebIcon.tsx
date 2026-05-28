import * as React from "react";

export interface WebIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
}

export function WebIcon({ size = 20, className, ...rest }: WebIconProps) {
  const gradientId = React.useId();

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...rest}
    >
      <defs>
        <linearGradient id={gradientId} x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>

      <g
        stroke={`url(#${gradientId})`}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12H21" />
        <path d="M12 3C9.5 5.4 8 8.6 8 12C8 15.4 9.5 18.6 12 21" />
        <path d="M12 3C14.5 5.4 16 8.6 16 12C16 15.4 14.5 18.6 12 21" />
      </g>
    </svg>
  );
}
