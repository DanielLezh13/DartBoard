import * as React from "react";

export interface ForkIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
}

export function ForkIcon({ size = 26, className, ...rest }: ForkIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512.853 512.853"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...rest}
    >
      <defs>
        <linearGradient
          id="forkGradient"
          x1="0"
          y1="0"
          x2="0"
          y2="512.853"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#38BDF8" />
          <stop offset="1" stopColor="#6366F1" />
        </linearGradient>
      </defs>
      <g transform="translate(35 25) scale(0.82)">
        <path
          d="M509.44,215.787L389.973,121.92c-2.56-1.707-6.827-2.56-9.387-0.853c-3.413,1.707-5.12,4.267-5.12,7.68v51.2
             c-24.747,2.56-50.347,16.213-76.8,40.96V137.28h51.2c3.413,0,6.827-1.707,8.533-5.12s0.853-6.827-0.853-9.387L263.68,3.307
             c-3.413-4.267-10.24-4.267-13.653,0L156.16,122.773c-1.707,2.56-2.56,5.973-0.853,9.387s4.267,5.12,7.68,5.12h51.2v84.48
             c-26.453-24.747-52.053-38.4-76.8-40.96v-52.053c0-3.413-2.56-5.973-5.12-7.68c-3.413-1.707-6.827-0.853-9.387,0.853
             L3.413,215.787C0.853,217.493,0,220.053,0,222.613s0.853,5.12,2.56,6.827l119.467,93.867c2.56,1.707,6.827,2.56,9.387,0.853
             c3.413-1.707,5.12-4.267,5.12-7.68v-50.347c41.813,6.827,76.8,64,76.8,110.08v128c0,5.12,3.413,8.533,8.533,8.533h68.267
             c5.12,0,8.533-3.413,8.533-8.533v-128c0-46.08,34.987-103.253,76.8-110.08v50.347c0,3.413,1.707,5.973,5.12,7.68
             s6.827,0.853,9.387-0.853L509.44,229.44c2.56-1.707,3.413-4.267,3.413-6.827S511.147,217.493,509.44,215.787z"
          stroke="url(#forkGradient)"
          strokeWidth={32}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </g>
    </svg>
  );
}
