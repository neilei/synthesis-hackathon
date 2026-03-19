/**
 * Maps a 0-100 score to a semantic accent color class.
 * Used for reputation scores, judge dimension scores, and progress bars.
 *
 * Thresholds: >= 70 positive (green), >= 50 warning (amber), < 50 danger (red).
 */
export function getScoreColor(
  score: number,
  type: "text" | "bg" = "text",
): string {
  const level = score >= 70 ? "positive" : score >= 50 ? "warning" : "danger";
  return `${type}-accent-${level}`;
}
