import * as React from "react";

export interface SimplifyIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
}

export function SimplifyIcon({ size = 24, className, ...rest }: SimplifyIconProps) {
  const gradientId = React.useId();

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...rest}
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="6"
          y1="26"
          x2="26"
          y2="6"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#38bdf8" />
          <stop offset="1" stopColor="#6366f1" />
        </linearGradient>
      </defs>

      {/* top A block */}
      <rect
        x={11}
        y={6}
        width={10}
        height={9}
        rx={2}
        stroke={`url(#${gradientId})`}
        strokeWidth={2.2}
      />
      <text
        x={16}
        y={12}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={5.5}
        fill="#bfdbfe"
      >
        A
      </text>

      {/* bottom-left B block */}
      <rect
        x={6}
        y={15}
        width={10}
        height={9}
        rx={2}
        stroke={`url(#${gradientId})`}
        strokeWidth={2.2}
      />
      <text
        x={11}
        y={20.5}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={5.5}
        fill="#bfdbfe"
      >
        B
      </text>

      {/* bottom-right C block */}
      <rect
        x={16}
        y={16.5}
        width={10}
        height={9}
        rx={2}
        stroke={`url(#${gradientId})`}
        strokeWidth={2.2}
      />
      <text
        x={21}
        y={22}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={5.5}
        fill="#bfdbfe"
      >
        C
      </text>
    </svg>
  );
}
