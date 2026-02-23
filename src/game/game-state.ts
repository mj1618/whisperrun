export interface LocalGameState {
  runner: {
    x: number;
    y: number;
    crouching: boolean;
    hiding: boolean;
    hasItem: boolean;
  };
  guards: Array<{
    id: string;
    x: number;
    y: number;
    angle: number;
    state: string;
    targetWaypoint: number;
    lastKnownX?: number;
    lastKnownY?: number;
    stateTimer?: number;
  }>;
  items: Array<{
    id: string;
    x: number;
    y: number;
    pickedUp: boolean;
    name: string;
  }>;
  pings: Array<{ x: number; y: number; type: string; createdAt: number }>;
  exitX: number;
  exitY: number;
  phase: string;
  startTime: number;
  heistStartTime?: number;
}

/**
 * Bridge between Convex subscriptions (async React state) and the
 * synchronous game loop. The React layer writes the latest server state;
 * the game loop reads it each frame.
 *
 * For the Runner, we also keep a local position that gets rendered
 * immediately (client prediction) while sending updates to Convex.
 */
export class GameStateManager {
  private serverState: LocalGameState | null = null;

  // Client-predicted runner position (rendered immediately)
  localRunnerX = 0;
  localRunnerY = 0;
  localCrouching = false;

  /** Called by the React layer when Convex subscription updates */
  setServerState(state: LocalGameState | null) {
    this.serverState = state;

    // On first state, snap local position to server
    if (state && this.localRunnerX === 0 && this.localRunnerY === 0) {
      this.localRunnerX = state.runner.x;
      this.localRunnerY = state.runner.y;
    }
  }

  /** Read by the game loop each frame */
  getState(): LocalGameState | null {
    return this.serverState;
  }

  /** Update local runner position (client prediction) */
  setLocalRunnerPosition(x: number, y: number, crouching: boolean) {
    this.localRunnerX = x;
    this.localRunnerY = y;
    this.localCrouching = crouching;
  }
}
