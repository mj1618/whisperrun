export type DifficultyLevel = "casual" | "standard" | "hard";

export interface DifficultyConfig {
  label: string;
  description: string;
  // Map generation
  gridCols: number;
  gridRows: number;
  minRooms: number;
  maxEmptySlots: number;
  // Entity counts
  numGuards: number;
  maxCameras: number;
  maxHideSpots: number;
  // Timing
  planningDurationMs: number;
  heistDurationMs: number;
  // Guard tuning
  guardSpeed: number;
  guardAlertSpeed: number;
  guardRange: number;
  guardCrouchRange: number;
  cameraRange: number;
  cameraSweepSpeed: number;
  // Laser tripwires
  maxLasers: number;
  laserOnMs: number;
  laserOffMs: number;
  // Guard alert escalation
  guardAlertRadius: number;
}

export const DIFFICULTY_CONFIGS: Record<DifficultyLevel, DifficultyConfig> = {
  casual: {
    label: "Casual",
    description: "Smaller map, slower guard, longer timer",
    gridCols: 3,
    gridRows: 2,
    minRooms: 4,
    maxEmptySlots: 1,
    numGuards: 1,
    maxCameras: 1,
    maxHideSpots: 8,
    planningDurationMs: 45_000,
    heistDurationMs: 240_000,
    guardSpeed: 1.6,
    guardAlertSpeed: 2.2,
    guardRange: 4,
    guardCrouchRange: 2,
    cameraRange: 5,
    cameraSweepSpeed: 0.5,
    maxLasers: 0,
    laserOnMs: 3000,
    laserOffMs: 3000,
    guardAlertRadius: 0,
  },
  standard: {
    label: "Standard",
    description: "The default heist experience",
    gridCols: 4,
    gridRows: 3,
    minRooms: 8,
    maxEmptySlots: 3,
    numGuards: 2,
    maxCameras: 3,
    maxHideSpots: 6,
    planningDurationMs: 30_000,
    heistDurationMs: 180_000,
    guardSpeed: 2.0,
    guardAlertSpeed: 2.8,
    guardRange: 5,
    guardCrouchRange: 3,
    cameraRange: 7,
    cameraSweepSpeed: 0.8,
    maxLasers: 2,
    laserOnMs: 3000,
    laserOffMs: 2500,
    guardAlertRadius: 8,
  },
  hard: {
    label: "Hard",
    description: "Big map, fast guards, tight timer",
    gridCols: 5,
    gridRows: 3,
    minRooms: 12,
    maxEmptySlots: 2,
    numGuards: 3,
    maxCameras: 5,
    maxHideSpots: 5,
    planningDurationMs: 20_000,
    heistDurationMs: 150_000,
    guardSpeed: 2.4,
    guardAlertSpeed: 3.2,
    guardRange: 6,
    guardCrouchRange: 4,
    cameraRange: 8,
    cameraSweepSpeed: 1.0,
    maxLasers: 3,
    laserOnMs: 3500,
    laserOffMs: 1500,
    guardAlertRadius: 12,
  },
};

export function getDifficultyConfig(level: DifficultyLevel): DifficultyConfig {
  return DIFFICULTY_CONFIGS[level];
}
