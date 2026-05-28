// components/icons/VaultIcon.tsx
import * as React from "react";

export interface VaultIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
}

export function VaultIcon({ size = 16, className, ...rest }: VaultIconProps) {
  const gradientId = React.useId(); // avoid id collisions

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...rest}
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="8"
          y1="8"
          x2="56"
          y2="56"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#38bdf8" /> {/* cyan */}
          <stop offset="100%" stopColor="#6366f1" /> {/* indigo */}
        </linearGradient>
      </defs>

      <g transform="translate(0, -3)">
        {/* Outer frame */}
        <rect
          x="8"
          y="8"
          width="48"
          height="48"
          rx="4"
          stroke={`url(#${gradientId})`}
          strokeWidth="3"
        />

        {/* Inner door */}
        <rect
          x="16"
          y="16"
          width="32"
          height="32"
          rx="2"
          stroke={`url(#${gradientId})`}
          strokeWidth="3"
        />

        {/* Hinges */}
        <line
          x1="16"
          y1="24"
          x2="22"
          y2="24"
          stroke={`url(#${gradientId})`}
          strokeWidth="3"
          strokeLinecap="round"
        />
        <line
          x1="16"
          y1="32"
          x2="22"
          y2="32"
          stroke={`url(#${gradientId})`}
          strokeWidth="3"
          strokeLinecap="round"
        />

        {/* Knob */}
        <circle
          cx="38"
          cy="32"
          r="5"
          stroke={`url(#${gradientId})`}
          strokeWidth="3"
        />

        {/* Feet */}
        <rect
          x="18"
          y="52"
          width="8"
          height="6"
          rx="1.5"
          stroke={`url(#${gradientId})`}
          strokeWidth="3"
        />
        <rect
          x="38"
          y="52"
          width="8"
          height="6"
          rx="1.5"
          stroke={`url(#${gradientId})`}
          strokeWidth="3"
        />
      </g>
    </svg>
  );
}