export const IS_DEV_LOG = process.env.NODE_ENV !== "production";

export function devLog(...args: unknown[]) {
  if (!IS_DEV_LOG) return;
  console.log(...args);
}
