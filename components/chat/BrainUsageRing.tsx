"use client";

import type React from "react";

export interface BrainUsageRingProps {
  /**
   * Usage ratio from 0.0 to 1.0 (0% to 100%)
   * Controls the progress ring fill amount.
   */
  usageRatio?: number;
  className?: string;
  onClick?: () => void;
  "aria-label"?: string;
  title?: string;
  /**
   * Whether this memory is attached to the current chat.
   * - true: gradient fill (sky-400 → indigo-500)
   * - false: gray fill (currentColor)
   */
  isAttached?: boolean;
  /**
   * Whether any memories are injected (pinned).
   * - true: blue color (injected)
   * - false: gray color (attached but not injected)
   */
  isInjected?: boolean;
  /**
   * Variant controls base styling:
   * - "default": standard gray → brighter on hover (composer, landing)
   * - "overlay": used in memory overlay header
   */
  variant?: "default" | "overlay";
  /**
   * Whether the SVG should scale with parent container.
   * - false (default): uses fixed w-8 h-8 for backward compatibility
   * - true: uses w-full h-full to respect parent sizing
   */
  scaleWithParent?: boolean;
}

/**
 * Brain icon with circular usage ring (AirPods battery-style indicator)
 * 
 * TODO: Calculate usageRatio from:
 * - Number of memories attached to chat
 * - Current context window size
 * - Token count vs max tokens
 */
export function BrainUsageRing({
  usageRatio = 0.0,
  className = "",
  onClick,
  "aria-label": ariaLabel = "Attach context",
  title = "Attach context",
  isAttached = false,
  isInjected = false,
  variant = "default",
  scaleWithParent = false,
}: BrainUsageRingProps) {
  // Clamp usage ratio to 0-1
  const clampedRatio = Math.max(0, Math.min(1, usageRatio));
  
  // SVG dimensions - enlarged container to prevent ring clipping
  // Ring extends: center + radius + strokeWidth/2 = 14 + 14.25 + 1.25 = 29.5px from center
  // Container increased from 28px to 32px to accommodate full ring with padding
  const containerSize = 32; // Enlarged container
  const size = 28; // Original size for calculations (keeps ring/brain in same visual position)
  const center = size / 2; // 14

  // Center the 28px drawing inside the 32px viewBox without changing any sizes
  const pad = (containerSize - size) / 2; // 2px
  const cx = center + pad;
  const cy = center + pad;

  const ringStrokeWidth = 2.25; // thinner
  const radius = center - ringStrokeWidth / 2 + 1.2; // wider circumference (closer to edge)
  const circumference = 2 * Math.PI * radius;
  
  // Brain icon sizing (decoupled from ring radius)
  const brainViewBoxSize = 100 // New SVG viewBox size
  
  // Pick the brain's rendered size in px inside the 28px drawing.
  // 18–20 usually looks right for a 28px icon with a ring.
  const targetBrainPx = 20
  
  const brainScale = targetBrainPx / brainViewBoxSize
  const brainScaledSize = brainViewBoxSize * brainScale
  
  const brainOffsetX = (size - brainScaledSize) / 2
  const brainOffsetY = (size - brainScaledSize) / 2 - 0.5
  
  // Calculate stroke-dashoffset for progress ring
  // Start from top (12 o'clock) and go clockwise
  const offset = circumference * (1 - clampedRatio);
  
  // Ring colors: gradient stroke to match mode pill
  const ringGradientId = "ringGradient";

  // Button styling based on variant and attached state
  // - default: blue-500/80 base, blue-500 on hover (matches send button)
  // - overlay: blue glow when attached, gray when not attached (memory overlay behavior)
  // When injected: blue color with glow, when not injected or not attached: gray color
  const activeBrainClass = "text-blue-300 transition-colors p-1 drop-shadow-[0_0_9px_rgba(96,165,250,0.6)]";
  const buttonClass = variant === "overlay"
    ? isAttached
      ? activeBrainClass // Overlay attached: blue with glow
      : "text-gray-400/60 transition-colors p-1" // Overlay not attached: gray
    : isAttached
      ? isInjected
        ? activeBrainClass // Default injected: blue with glow
        : "text-gray-500 transition-colors p-1" // Default attached but not injected: gray color
      : "text-gray-500 transition-colors p-1"; // Default not attached: gray (was blue)

  return (
    <button
      onClick={onClick}
      className={`${buttonClass} ${className} relative translate-y-[1.5px]`}
      aria-label={ariaLabel}
      title={title}
    >
      <svg
        className={scaleWithParent ? "w-full h-full" : "w-8 h-8"}
        viewBox={`0 0 ${containerSize} ${containerSize}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="brainGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="currentColor" stopOpacity={1} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={1} />
          </linearGradient>
          <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="currentColor" stopOpacity={1} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={1} />
          </linearGradient>
        </defs>
        {/* Background ring (dark steel/navy track) */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          stroke="rgba(51, 65, 85, 0.75)"
          strokeWidth={ringStrokeWidth}
          fill="none"
        />
        
        {/* Progress ring (blue gradient, fills clockwise) */}
        {clampedRatio > 0 && (
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            stroke={isAttached ? (isInjected ? "url(#ringGradient)" : "currentColor") : "currentColor"}
            strokeWidth={ringStrokeWidth}
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform={`rotate(-90 ${cx} ${cy})`} // Start from top, fill clockwise
          />
        )}
        
        {/* Brain icon (fixed size, decoupled from ring) */}
        <g transform={`translate(${brainOffsetX + pad}, ${brainOffsetY + pad}) scale(${brainScale})`}>
          <path
            d="m83.453 38.32c0.21875-4.0469-1.5781-8.2031-4.8203-10.711-0.67969-0.53125-1.4219-0.97656-2.2031-1.3438 0.35156-4.7109-1.3828-9.5391-4.7344-12.797-4.2266-4.1094-11.227-5.2656-17.039-2.8125-1.8594 0.78125-3.4297 1.8828-4.6641 3.2109-1.2344-1.3281-2.8047-2.4219-4.6641-3.2109-5.8047-2.4531-12.812-1.2969-17.039 2.8125-3.3516 3.2578-5.0859 8.0859-4.7344 12.797-0.78125 0.36719-1.5234 0.82031-2.2031 1.3438-3.2344 2.5156-5.0391 6.6641-4.8203 10.711-4.7344 3.2656-6.9141 9.8203-4.8047 15.516 0.5625 1.5156 1.4219 2.8906 2.4766 4.0938-1.4062 4.5-1.0703 9.4922 1 13.75 2.1328 4.375 5.9844 7.7578 10.531 9.3359 1.9297 5.5391 7.4062 9.6094 13.297 9.6094h0.14844c4.1484-0.046875 8.1406-2.1953 10.805-5.3984 2.6641 3.2031 6.6641 5.3438 10.805 5.3984h0.14844c5.8828 0 11.359-4.0703 13.297-9.6094 4.5469-1.5703 8.3984-4.9609 10.531-9.3359 2.0703-4.2578 2.4062-9.25 1-13.75 1.0625-1.2031 1.9219-2.5781 2.4766-4.0938 2.125-5.6953-0.054688-12.25-4.7891-15.516zm-44.336 46.055h-0.078126c-3.5156 0-7.0156-2.9375-7.6719-6.4453-0.22656-1.2266-1.1641-2.2031-2.375-2.4766-3.4609-0.78906-6.5859-3.2812-8.1562-6.5078-1.0547-2.1641-1.4062-4.6797-1.0938-7.0859 1.7344 0.71094 3.5938 1.1094 5.4688 1.1094 0.88281 0 1.7578-0.085938 2.625-0.26562 1.6875-0.35156 2.7812-2 2.4297-3.6953-0.35156-1.6875-2-2.7812-3.6953-2.4297-2.1719 0.44531-4.5312-0.19531-6.3359-1.5156-0.21875-0.25781-0.49219-0.47656-0.79688-0.65625-0.82031-0.77344-1.4688-1.6953-1.8516-2.7344-1.2578-3.3984 0.39844-7.4922 3.5391-8.7656 1.4688-0.59375 2.2656-2.2031 1.8359-3.7344-0.64844-2.3359 0.28125-5.1172 2.2188-6.6172 1.9531-1.5156 4.9531-1.75 7.125-0.5625 1.5156 0.82812 3.4141 0.27344 4.2422-1.2344 0.82812-1.5156 0.27344-3.4141-1.2344-4.2422-1.6953-0.92969-3.6172-1.4219-5.5469-1.5 0.015625-2.6328 1.0469-5.2891 2.875-7.0703 2.7578-2.6797 7.2422-2.8047 10.25-1.5312 1.4844 0.625 3.9688 2.1719 3.9688 5.4688v55.938c-0.65625 3.4688-4.2266 6.5156-7.7422 6.5547zm40.047-15.43c-1.5703 3.2266-4.6953 5.7188-8.1562 6.5078-1.2188 0.27344-2.1484 1.25-2.375 2.4766-0.64844 3.5078-4.1562 6.4453-7.6719 6.4453h-0.078126c-3.5156-0.039062-7.0859-3.0859-7.7578-6.5625v-55.938c0-3.2969 2.4844-4.8359 3.9688-5.4688 3-1.2734 7.4922-1.1484 10.25 1.5312 1.8281 1.7812 2.8594 4.4375 2.875 7.0703-1.9375 0.078126-3.8516 0.5625-5.5469 1.5-1.5156 0.82813-2.0703 2.7266-1.2344 4.2422 0.82812 1.5156 2.7266 2.0703 4.2422 1.2344 2.1719-1.1875 5.1719-0.96094 7.125 0.5625 1.9375 1.5 2.8672 4.2891 2.2188 6.6172-0.42188 1.5312 0.36719 3.1328 1.8359 3.7344 3.1406 1.2734 4.7969 5.375 3.5391 8.7734-0.38281 1.0391-1.0312 1.9688-1.8516 2.7344-0.30469 0.17969-0.57812 0.39844-0.79688 0.65625-1.8047 1.3203-4.1562 1.9609-6.3359 1.5156-1.6875-0.35156-3.3438 0.74219-3.6953 2.4297s0.73438 3.3438 2.4297 3.6953c0.86719 0.17969 1.75 0.26562 2.625 0.26562 1.875 0 3.7344-0.39844 5.4688-1.1094 0.32812 2.4062-0.03125 4.9297-1.0781 7.0859zm-19.984-18.82c-2.375-3.4531-1.5625-8.5156 1.7812-11.047s8.4297-1.9531 11.117 1.2734c1.1016 1.3281 0.92188 3.2969-0.39844 4.3984-1.3281 1.1016-3.2969 0.92188-4.3984-0.39844-0.54688-0.66406-1.8516-0.80469-2.5391-0.28906s-0.89063 1.8125-0.40625 2.5234c0.97656 1.4219 0.61719 3.3672-0.80469 4.3438-0.53906 0.375-1.1562 0.54687-1.7656 0.54687-1 0.007813-1.9844-0.46875-2.5859-1.3516zm-27.117 2.6875c-0.41406 0-0.82812-0.03125-1.2344-0.085938-1.7109-0.23437-2.9062-1.8125-2.6719-3.5234s1.8125-2.9062 3.5234-2.6719c1.3125 0.17969 2.7891-0.54688 3.4375-1.6953 0.64844-1.1484 0.52344-2.7891-0.30469-3.8203-1.0781-1.3516-0.85938-3.3125 0.49219-4.3906 1.3516-1.0781 3.3125-0.85938 4.3906 0.49219 2.4062 3.0156 2.7578 7.4609 0.85938 10.812-1.7031 2.9844-5.0703 4.8828-8.4922 4.8828zm38.891 16.203c-0.015625 1.7188-1.4141 3.0938-3.125 3.0938h-0.03125c-5.2266-0.046875-10.039-3.7422-11.438-8.7734-0.46094-1.6641 0.50781-3.3828 2.1719-3.8438 1.6641-0.46094 3.3828 0.50781 3.8438 2.1719 0.64844 2.3359 3.0547 4.1797 5.4766 4.2031 1.7344 0.015624 3.1172 1.4219 3.1016 3.1484zm-27.672-5.5078c0.30469 1.6953-0.82031 3.3203-2.5234 3.625-0.94531 0.17188-1.8203 0.69531-2.4141 1.4531-0.59375 0.75-0.89844 1.7344-0.83594 2.6875 0.10938 1.7266-1.2031 3.2031-2.9297 3.3125-0.0625 0.007812-0.13281 0.007812-0.19531 0.007812-1.6406 0-3.0156-1.2734-3.1172-2.9297-0.14844-2.4609 0.63281-4.9922 2.1641-6.9297s3.7891-3.3047 6.2188-3.7422c1.6953-0.3125 3.3281 0.82031 3.6328 2.5156z"
            fill={isAttached ? (isInjected ? "url(#brainGradient)" : "currentColor") : "currentColor"}
            stroke={isAttached ? (isInjected ? "url(#brainGradient)" : "currentColor") : "currentColor"}
            strokeWidth="0.5"
            strokeLinejoin="round"
          />
        </g>
      </svg>
    </button>
  );
}
