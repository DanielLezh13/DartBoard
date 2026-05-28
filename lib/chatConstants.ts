// Layout breakpoint constants
export const WIDE_MIN = 1280;
export const MEDIUM_MIN = 860;

// Dev flag to hide debug HUD
export const SHOW_DEV_HUD = false;

// Animation timing constants
export const SLIDE_MS = 300;
export const SLIDE_EASE = "ease-in-out";
export const slideTransition = `transform ${SLIDE_MS}ms ${SLIDE_EASE}`;

// Dock width constants (in pixels)
export const LEFT_RAIL_W = 72;
export const LEFT_PANEL_W = 256;
export const LEFT_DOCK_W = 336; // Actual width from CSS (includes padding/borders)
export const RIGHT_RAIL_W = 72;
export const RIGHT_PANEL_W = 256;
export const RIGHT_DOCK_W_OPEN = 329; // RIGHT_PANEL_W (256) + divider (1) + RIGHT_RAIL_W (72) = 329
export const RIGHT_DOCK_W_CLOSED = RIGHT_RAIL_W; // 72px

// Clean constants for 5-column grid (Step 2)
export const LEFT_PANEL_W_CLEAN = 329; // Match drawer width (256 + 72 + 1 = 329)
export const LEFT_RAIL_W_CLEAN = 8;
export const RIGHT_PANEL_W_CLEAN = 329; // Match RIGHT_DOCK_W_OPEN (256 + 1 + 72 = 329)
export const RIGHT_RAIL_W_CLEAN = 8;

// Button offset constant (12px = 0.75rem = 3 * 0.25rem)
export const BUTTON_OFFSET_PX = 12;






