import * as React from "react";

interface UnsortedIconProps {
  className?: string;
  style?: React.CSSProperties;
}

export function UnsortedIcon({ className, style }: UnsortedIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 60"
      className={className}
      style={{ ...style, filter: 'drop-shadow(0 0 2px rgba(255, 255, 255, 0.4))' }}
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        d="M34.59,7.17A4,4,0,0,0,31.76,6H8a4,4,0,0,0-4,4V39a4,4,0,0,0,4,4H40a4,4,0,0,0,4-4V18.24a4,4,0,0,0-1.17-2.82ZM19,8H29v5H19ZM13,8h4v5H13ZM35,41H13V28a1,1,0,0,1,1-1H34a1,1,0,0,1,1,1Zm7-2a2,2,0,0,1-2,2H37V28a3,3,0,0,0-3-3H14a3,3,0,0,0-3,3V41H8a2,2,0,0,1-2-2V10A2,2,0,0,1,8,8h3v6a1,1,0,0,0,1,1H30a1,1,0,0,0,1-1V8h.76a2,2,0,0,1,1.41.59l8.25,8.24A2,2,0,0,1,42,18.24Z"
        fill="currentColor"
      />
      <path d="M31,29H17a1,1,0,0,0,0,2H31a1,1,0,0,0,0-2Z" fill="currentColor" />
      <path d="M31,33H17a1,1,0,0,0,0,2H31a1,1,0,0,0,0-2Z" fill="currentColor" />
      <path d="M23,37H17a1,1,0,0,0,0,2h6a1,1,0,0,0,0-2Z" fill="currentColor" />
    </svg>
  );
}

