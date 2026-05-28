import * as React from "react";

export interface PacifierIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
  showMarks?: boolean;
}

export function PacifierIcon({
  size = 14,
  showMarks = true,
  className = "",
  ...rest
}: PacifierIconProps) {
  const gradientId = React.useId(); // avoid id collisions

  // Original path includes the inner "measurement" marks as repeated left-side detours.
  // We can derive a "solid" variant by removing those mark segments.
  const PATH_WITH_MARKS =
    "m324.11,178.375v-43.881c0-5.523-4.477-10-10-10h-12.648v-14.787c0-16.146-13.136-29.282-29.282-29.282-2.558,0-4.94-1.018-6.708-2.867s-2.678-4.274-2.564-6.829l1.355-30.311c0.476-10.652-3.32-20.762-10.69-28.469-7.369-7.705-17.299-11.949-27.962-11.949s-20.593,4.244-27.963,11.95c-7.369,7.707-11.165,17.816-10.689,28.468l1.355,30.311c0.114,2.555-0.796,4.98-2.564,6.829-1.768,1.849-4.15,2.867-6.708,2.867-16.146,0-29.281,13.136-29.281,29.282v14.787h-12.642c-5.523,0-10,4.477-10,10v43.881c-9.81,3.477-16.857,12.844-16.857,23.83v223.747c0,13.938 11.339,25.277 25.278,25.277h180.149c13.938,0 25.278-11.339 25.278-25.277v-223.747c0-10.986-7.048-20.354-16.857-23.83zm-154.349-68.668c0-5.118 4.164-9.282 9.282-9.282 8.07,0 15.585-3.212 21.163-9.044s8.45-13.484 8.09-21.545l-1.355-30.311c-0.23-5.146 1.604-10.029 5.163-13.752 3.559-3.723 8.356-5.773 13.507-5.773s9.948,2.05 13.508,5.772c3.56,3.723 5.394,8.607 5.164,13.752l-1.355,30.311c-0.36,8.062 2.513,15.713 8.09,21.545s13.093,9.044 21.163,9.044c5.118,0 9.282,4.164 9.282,9.282v14.787h-111.7v-14.786zm-22.644,34.787h156.991v32.433h-156.991v-32.433zm173.848,281.457c0,2.91-2.368,5.277-5.278,5.277h-180.149c-2.91,0-5.278-2.367-5.278-5.277v-31.377h24.856c5.523,0 10-4.477 10-10s-4.477-10-10-10h-24.856v-26.998h24.856c5.523,0 10-4.477 10-10s-4.477-10-10-10h-24.856v-26.998h24.856c5.523,0 10-4.477 10-10s-4.477-10-10-10h-24.856v-26.998h24.856c5.523,0 10-4.477 10-10s-4.477-10-10-10h-24.856v-31.376c0-2.91 2.368-5.278 5.278-5.278h180.149c2.91,0 5.278,2.368 5.278,5.278v223.747z";

  const MARK_SEGMENT = "h24.856c5.523,0 10-4.477 10-10s-4.477-10-10-10h-24.856";
  const PATH_SOLID = PATH_WITH_MARKS.split(MARK_SEGMENT).join("");
  const pathD = showMarks ? PATH_WITH_MARKS : PATH_SOLID;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 451.229 451.229"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...rest}
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="0"
          y1="0"
          x2="451.229"
          y2="451.229"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>

      <g
        fill={showMarks ? `url(#${gradientId})` : "none"}
        stroke={`url(#${gradientId})`}
        strokeWidth={showMarks ? 10 : 9}
        strokeLinecap="round"
        strokeLinejoin="round"
        shapeRendering="geometricPrecision"
        transform="translate(225.6145, 225.6145) scale(0.90) translate(-225.6145, -225.6145)"
      >
        <path d={pathD} />
      </g>
    </svg>
  );
}