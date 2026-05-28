// components/icons/CopyIcon.tsx
import * as React from "react";

export interface CopyIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
}

export function CopyIcon({ size = 18, className, ...rest }: CopyIconProps) {
  const gradientId = React.useId();

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
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>

      {/* back sheet */}
      <rect
        x="18"
        y="14"
        width="30"
        height="40"
        rx="4"
        stroke={`url(#${gradientId})`}
        strokeWidth="4"
      />

      {/* front sheet */}
      <rect
        x="12"
        y="8"
        width="30"
        height="40"
        rx="4"
        stroke={`url(#${gradientId})`}
        strokeWidth="4"
      />
    </svg>
  );
}