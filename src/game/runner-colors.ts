/**
 * Runner color presets for character customization.
 *
 * Each preset defines the 5 key colors used by drawRunnerSprite().
 * All presets follow the same luminance hierarchy:
 *   legs (darkest) < body (mid) < head (lightest)
 * to ensure readability at small sprite sizes.
 */

export interface RunnerColorPreset {
  id: string;
  label: string;
  body: string;
  bodyOutline: string;
  head: string;
  legs: string;
  hidingOutline: string;
}

export const RUNNER_COLOR_PRESETS: RunnerColorPreset[] = [
  {
    id: "classic",
    label: "Classic",
    body: "#E39B32",
    bodyOutline: "#B47820",
    head: "#F0B050",
    legs: "#8B6914",
    hidingOutline: "rgba(227, 155, 50, 0.6)",
  },
  {
    id: "midnight",
    label: "Midnight",
    body: "#3B5998",
    bodyOutline: "#2B4478",
    head: "#5B79B8",
    legs: "#1A2540",
    hidingOutline: "rgba(59, 89, 152, 0.6)",
  },
  {
    id: "forest",
    label: "Forest",
    body: "#4A8B5C",
    bodyOutline: "#357043",
    head: "#6AAB7C",
    legs: "#2D5A3A",
    hidingOutline: "rgba(74, 139, 92, 0.6)",
  },
  {
    id: "crimson",
    label: "Crimson",
    body: "#C04040",
    bodyOutline: "#8B2020",
    head: "#E06060",
    legs: "#6B1A1A",
    hidingOutline: "rgba(192, 64, 64, 0.6)",
  },
  {
    id: "violet",
    label: "Violet",
    body: "#7B52AB",
    bodyOutline: "#5A3A8B",
    head: "#9B72CB",
    legs: "#3D2A5A",
    hidingOutline: "rgba(123, 82, 171, 0.6)",
  },
  {
    id: "ghost",
    label: "Ghost",
    body: "#B8B8B8",
    bodyOutline: "#888888",
    head: "#D8D8D8",
    legs: "#707070",
    hidingOutline: "rgba(184, 184, 184, 0.6)",
  },
];

export function getRunnerPreset(id: string): RunnerColorPreset {
  return RUNNER_COLOR_PRESETS.find((p) => p.id === id) ?? RUNNER_COLOR_PRESETS[0];
}
