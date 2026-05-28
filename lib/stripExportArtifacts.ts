/**
 * Strip export artifact glyphs that commonly appear as "tofu" squares.
 *
 * Removes:
 * - Private Use Area characters (U+E000..U+F8FF)
 * - Interlinear annotation/object replacement artifacts (U+FFF9..U+FFFC)
 * - Unicode replacement character (U+FFFD)
 */
const EXPORT_ARTIFACT_GLYPHS_REGEX = /[\uE000-\uF8FF\uFFF9-\uFFFC\uFFFD]/g;

export function stripExportArtifacts(value: string): string {
  if (!value) return "";
  return value.replace(EXPORT_ARTIFACT_GLYPHS_REGEX, "");
}

