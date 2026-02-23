import { TileType } from "@/game/map";
import { RoomChunk, ROOM_CHUNKS, LOBBY_CHUNK } from "@/game/room-chunks";
import { SeededRandom } from "@/lib/random";
import { TARGET_ITEMS } from "@/game/target-items";

export interface MapEntity {
  type: "guard" | "item" | "camera" | "hideSpot" | "exit" | "runnerSpawn";
  x: number;
  y: number;
  id?: string;
  name?: string;
  facing?: "up" | "down" | "left" | "right";
}

export interface GuardPatrol {
  guardId: string;
  spawnX: number;
  spawnY: number;
  waypoints: Array<{ x: number; y: number }>;
}

export interface GeneratedMap {
  tiles: TileType[][];
  width: number;
  height: number;
  entities: MapEntity[];
  guardPatrols: GuardPatrol[];
  runnerSpawn: { x: number; y: number };
  exitPos: { x: number; y: number };
  targetItem: { x: number; y: number; name: string };
}

// Grid layout: 4 columns x 3 rows of slots
const GRID_COLS = 4;
const GRID_ROWS = 3;

// Each slot is big enough for the largest room (9x9) + padding
const SLOT_WIDTH = 11;
const SLOT_HEIGHT = 11;

// Total map dimensions (with 1-tile border)
const MAP_WIDTH = GRID_COLS * SLOT_WIDTH + 2;
const MAP_HEIGHT = GRID_ROWS * SLOT_HEIGHT + 2;

interface SlotInfo {
  col: number;
  row: number;
  chunk: RoomChunk;
  // Top-left tile position of the chunk in the full map
  tileX: number;
  tileY: number;
  // Center tile of the chunk in the full map
  centerX: number;
  centerY: number;
}

/**
 * Generate a complete map from a seed. Pure function — same seed always
 * returns the same map.
 */
export function generateMap(seed: number): GeneratedMap {
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = tryGenerate(seed + attempt);
    if (result) return result;
  }
  // Fallback: return result from last attempt regardless of connectivity
  return tryGenerate(seed + 10, true)!;
}

function tryGenerate(seed: number, skipValidation = false): GeneratedMap | null {
  const rng = new SeededRandom(seed);

  // Step 1: Decide which slots to fill
  const allSlots: Array<{ col: number; row: number }> = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      allSlots.push({ col: c, row: r });
    }
  }

  // Lobby always goes in bottom-left (0, 2)
  const lobbySlot = { col: 0, row: GRID_ROWS - 1 };

  // Pick which other slots to fill (8-11 total including lobby)
  const otherSlots = allSlots.filter(
    (s) => !(s.col === lobbySlot.col && s.row === lobbySlot.row)
  );
  rng.shuffle(otherSlots);

  const numEmpty = rng.nextInt(1, 3);
  const filledOtherSlots = otherSlots.slice(0, otherSlots.length - numEmpty);

  // Ensure connectivity: all filled slots must form a connected group
  // with the lobby. Use BFS to verify, and if not connected, add slots
  // to bridge gaps.
  const filledSet = new Set<string>();
  filledSet.add(`${lobbySlot.col},${lobbySlot.row}`);
  for (const s of filledOtherSlots) {
    filledSet.add(`${s.col},${s.row}`);
  }

  // BFS from lobby to find reachable slots
  ensureConnectivity(filledSet, lobbySlot);

  // Step 2: Assign chunks to slots
  const availableChunks = [...ROOM_CHUNKS];
  rng.shuffle(availableChunks);
  let chunkIdx = 0;

  const slots: SlotInfo[] = [];

  // Place lobby
  const lobbyTileX = 1 + lobbySlot.col * SLOT_WIDTH + Math.floor((SLOT_WIDTH - LOBBY_CHUNK.width) / 2);
  const lobbyTileY = 1 + lobbySlot.row * SLOT_HEIGHT + Math.floor((SLOT_HEIGHT - LOBBY_CHUNK.height) / 2);
  slots.push({
    col: lobbySlot.col,
    row: lobbySlot.row,
    chunk: LOBBY_CHUNK,
    tileX: lobbyTileX,
    tileY: lobbyTileY,
    centerX: lobbyTileX + Math.floor(LOBBY_CHUNK.width / 2),
    centerY: lobbyTileY + Math.floor(LOBBY_CHUNK.height / 2),
  });

  // Place other rooms
  for (const s of Array.from(filledSet)
    .map((key) => {
      const [c, r] = key.split(",").map(Number);
      return { col: c, row: r };
    })
    .filter((s) => !(s.col === lobbySlot.col && s.row === lobbySlot.row))
  ) {
    const chunk = availableChunks[chunkIdx % availableChunks.length];
    chunkIdx++;

    const tileX = 1 + s.col * SLOT_WIDTH + Math.floor((SLOT_WIDTH - chunk.width) / 2);
    const tileY = 1 + s.row * SLOT_HEIGHT + Math.floor((SLOT_HEIGHT - chunk.height) / 2);

    slots.push({
      col: s.col,
      row: s.row,
      chunk,
      tileX,
      tileY,
      centerX: tileX + Math.floor(chunk.width / 2),
      centerY: tileY + Math.floor(chunk.height / 2),
    });
  }

  // Step 3: Create tile grid (all walls initially)
  const tiles: TileType[][] = [];
  for (let r = 0; r < MAP_HEIGHT; r++) {
    tiles.push(new Array(MAP_WIDTH).fill(TileType.Wall));
  }

  // Step 4: Stamp chunks onto the map
  for (const slot of slots) {
    stampChunk(tiles, slot);
  }

  // Step 5: Connect adjacent rooms with hallways
  const slotMap = new Map<string, SlotInfo>();
  for (const slot of slots) {
    slotMap.set(`${slot.col},${slot.row}`, slot);
  }

  for (const slot of slots) {
    // Check right neighbor
    const rightKey = `${slot.col + 1},${slot.row}`;
    const rightSlot = slotMap.get(rightKey);
    if (rightSlot) {
      connectHorizontal(tiles, slot, rightSlot);
    }

    // Check bottom neighbor
    const bottomKey = `${slot.col},${slot.row + 1}`;
    const bottomSlot = slotMap.get(bottomKey);
    if (bottomSlot) {
      connectVertical(tiles, slot, bottomSlot);
    }
  }

  // Step 6: Place entities
  const entities: MapEntity[] = [];

  // Runner spawn: center of lobby
  const runnerSpawn = findFloorTileNear(tiles, slots[0].centerX, slots[0].centerY);

  // Exit: near the bottom of the lobby
  const exitPos = findFloorTileNear(tiles, slots[0].tileX + 2, slots[0].tileY + slots[0].chunk.height - 2);
  tiles[exitPos.y][exitPos.x] = TileType.Exit;
  entities.push({ type: "exit", ...exitPos });
  entities.push({ type: "runnerSpawn", ...runnerSpawn });

  // Target item: pick the room farthest from lobby
  const nonLobbySlots = slots.filter((s) => s.chunk.name !== "Lobby");
  nonLobbySlots.sort((a, b) => {
    const distA = Math.abs(a.col - lobbySlot.col) + Math.abs(a.row - lobbySlot.row);
    const distB = Math.abs(b.col - lobbySlot.col) + Math.abs(b.row - lobbySlot.row);
    return distB - distA;
  });

  const itemRoom = nonLobbySlots[0];
  let itemPos: { x: number; y: number };
  if (itemRoom.chunk.itemSpots && itemRoom.chunk.itemSpots.length > 0) {
    const spot = rng.pick(itemRoom.chunk.itemSpots);
    itemPos = { x: itemRoom.tileX + spot.x, y: itemRoom.tileY + spot.y };
  } else {
    itemPos = findFloorTileNear(tiles, itemRoom.centerX, itemRoom.centerY);
  }
  // Ensure we don't place item on a wall
  if (tiles[itemPos.y][itemPos.x] === TileType.Wall) {
    itemPos = findFloorTileNear(tiles, itemRoom.centerX, itemRoom.centerY);
  }
  tiles[itemPos.y][itemPos.x] = TileType.ItemSpawn;

  const targetItemDef = rng.pick(TARGET_ITEMS);
  const targetItem = { ...itemPos, name: targetItemDef.name };
  entities.push({ type: "item", ...itemPos, id: "item-1", name: targetItemDef.name });

  // Guards: 1-2 guards
  const totalRooms = slots.length;
  const numGuards = totalRooms >= 10 ? 2 : 1;
  const guardPatrols: GuardPatrol[] = [];

  // Pick rooms for guard spawns (avoid lobby and item room)
  const guardCandidateSlots = nonLobbySlots.filter((s) => s !== itemRoom);
  rng.shuffle(guardCandidateSlots);

  for (let g = 0; g < numGuards && g < guardCandidateSlots.length; g++) {
    const guardRoom = guardCandidateSlots[g];
    let spawnPos: { x: number; y: number };

    if (guardRoom.chunk.guardSpawns && guardRoom.chunk.guardSpawns.length > 0) {
      const spot = rng.pick(guardRoom.chunk.guardSpawns);
      spawnPos = { x: guardRoom.tileX + spot.x, y: guardRoom.tileY + spot.y };
    } else {
      spawnPos = { x: guardRoom.centerX, y: guardRoom.centerY };
    }

    if (tiles[spawnPos.y][spawnPos.x] === TileType.Wall) {
      spawnPos = findFloorTileNear(tiles, guardRoom.centerX, guardRoom.centerY);
    }

    // Generate patrol waypoints: loop through 3-5 adjacent rooms
    const waypoints = generatePatrolWaypoints(rng, guardRoom, slots, slotMap, tiles);

    const guardId = `guard-${g + 1}`;
    entities.push({ type: "guard", ...spawnPos, id: guardId });
    guardPatrols.push({
      guardId,
      spawnX: spawnPos.x,
      spawnY: spawnPos.y,
      waypoints,
    });
  }

  // Hide spots: place from chunk definitions
  let hideSpotCount = 0;
  for (const slot of slots) {
    if (!slot.chunk.hideSpots) continue;
    for (const hs of slot.chunk.hideSpots) {
      const x = slot.tileX + hs.x;
      const y = slot.tileY + hs.y;
      if (tiles[y][x] === TileType.HideSpot) {
        entities.push({ type: "hideSpot", x, y });
        hideSpotCount++;
      }
    }
  }

  // If fewer than 4 hide spots, add some in random rooms
  if (hideSpotCount < 4) {
    const candidates = nonLobbySlots.filter((s) => !s.chunk.hideSpots || s.chunk.hideSpots.length === 0);
    rng.shuffle(candidates);
    for (const slot of candidates) {
      if (hideSpotCount >= 6) break;
      const pos = findFloorTileNear(tiles, slot.centerX + rng.nextInt(-1, 1), slot.centerY + rng.nextInt(-1, 1));
      if (tiles[pos.y][pos.x] === TileType.Floor) {
        tiles[pos.y][pos.x] = TileType.HideSpot;
        entities.push({ type: "hideSpot", x: pos.x, y: pos.y });
        hideSpotCount++;
      }
    }
  }

  // Cameras: place from chunk definitions (1-3)
  let cameraCount = 0;
  for (const slot of slots) {
    if (!slot.chunk.cameraSpots) continue;
    for (const cs of slot.chunk.cameraSpots) {
      if (cameraCount >= 3) break;
      const x = slot.tileX + cs.x;
      const y = slot.tileY + cs.y;
      if (tiles[y][x] === TileType.Camera) {
        entities.push({ type: "camera", x, y, id: `camera-${cameraCount}`, facing: cs.facing });
        cameraCount++;
      }
    }
  }

  // Step 7: Validate connectivity
  if (!skipValidation) {
    const reachable = floodFill(tiles, runnerSpawn.x, runnerSpawn.y);

    // Check all critical positions are reachable
    const criticalPositions = [
      exitPos,
      itemPos,
      ...guardPatrols.map((gp) => ({ x: gp.spawnX, y: gp.spawnY })),
    ];

    for (const pos of criticalPositions) {
      if (!reachable.has(`${pos.x},${pos.y}`)) {
        return null; // Connectivity failure — retry with different seed
      }
    }
  }

  return {
    tiles,
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    entities,
    guardPatrols,
    runnerSpawn,
    exitPos,
    targetItem,
  };
}

// --- Helpers ---

function stampChunk(tiles: TileType[][], slot: SlotInfo): void {
  const { chunk, tileX, tileY } = slot;
  for (let r = 0; r < chunk.height; r++) {
    const mapRow = tileY + r;
    if (mapRow < 0 || mapRow >= tiles.length) continue;
    for (let c = 0; c < chunk.width; c++) {
      const mapCol = tileX + c;
      if (mapCol < 0 || mapCol >= (tiles[0]?.length ?? 0)) continue;
      tiles[mapRow][mapCol] = chunk.tiles[r][c];
    }
  }
}

function connectHorizontal(tiles: TileType[][], left: SlotInfo, right: SlotInfo): void {
  // Find the best opening pair
  const leftOpenings = left.chunk.openings.right ?? [];
  const rightOpenings = right.chunk.openings.left ?? [];

  // The row in map space where we'll carve the hallway
  let hallwayRow: number;

  if (leftOpenings.length > 0 && rightOpenings.length > 0) {
    // Find closest pair
    let bestDist = Infinity;
    let bestLeftRow = leftOpenings[0];
    let bestRightRow = rightOpenings[0];
    for (const lr of leftOpenings) {
      for (const rr of rightOpenings) {
        const leftMapRow = left.tileY + lr;
        const rightMapRow = right.tileY + rr;
        const dist = Math.abs(leftMapRow - rightMapRow);
        if (dist < bestDist) {
          bestDist = dist;
          bestLeftRow = lr;
          bestRightRow = rr;
        }
      }
    }
    const leftMapRow = left.tileY + bestLeftRow;
    const rightMapRow = right.tileY + bestRightRow;
    hallwayRow = Math.round((leftMapRow + rightMapRow) / 2);

    // Carve from the right edge of left room to left edge of right room
    const startCol = left.tileX + left.chunk.width;
    const endCol = right.tileX;

    // Carve horizontal segment at hallwayRow
    for (let c = startCol - 1; c <= endCol; c++) {
      if (c >= 0 && c < MAP_WIDTH && hallwayRow >= 0 && hallwayRow < MAP_HEIGHT) {
        if (tiles[hallwayRow][c] === TileType.Wall) {
          tiles[hallwayRow][c] = TileType.Floor;
        }
      }
    }

    // If the rows don't match, carve vertical segments to connect
    if (leftMapRow !== hallwayRow) {
      const col = startCol - 1;
      const minR = Math.min(leftMapRow, hallwayRow);
      const maxR = Math.max(leftMapRow, hallwayRow);
      for (let r = minR; r <= maxR; r++) {
        if (tiles[r][col] === TileType.Wall) {
          tiles[r][col] = TileType.Floor;
        }
      }
    }
    if (rightMapRow !== hallwayRow) {
      const col = endCol;
      const minR = Math.min(rightMapRow, hallwayRow);
      const maxR = Math.max(rightMapRow, hallwayRow);
      for (let r = minR; r <= maxR; r++) {
        if (tiles[r][col] === TileType.Wall) {
          tiles[r][col] = TileType.Floor;
        }
      }
    }
  } else {
    // No matching openings — carve through at the midpoint between rooms
    const midRow = Math.round((left.centerY + right.centerY) / 2);
    hallwayRow = midRow;

    const startCol = left.tileX + left.chunk.width;
    const endCol = right.tileX;

    for (let c = startCol - 1; c <= endCol; c++) {
      if (c >= 0 && c < MAP_WIDTH && hallwayRow >= 0 && hallwayRow < MAP_HEIGHT) {
        if (tiles[hallwayRow][c] === TileType.Wall) {
          tiles[hallwayRow][c] = TileType.Floor;
        }
      }
    }

    // Also carve into the rooms themselves to ensure the hallway connects
    // to an interior floor tile
    carveIntoRoom(tiles, left, hallwayRow, "right");
    carveIntoRoom(tiles, right, hallwayRow, "left");
  }

  // Place door tiles at connection boundaries
  const doorCol1 = left.tileX + left.chunk.width - 1;
  const doorCol2 = right.tileX;
  if (tiles[hallwayRow][doorCol1] === TileType.Floor) {
    tiles[hallwayRow][doorCol1] = TileType.Door;
  }
  if (tiles[hallwayRow][doorCol2] === TileType.Floor) {
    tiles[hallwayRow][doorCol2] = TileType.Door;
  }
}

function connectVertical(tiles: TileType[][], top: SlotInfo, bottom: SlotInfo): void {
  const topOpenings = top.chunk.openings.bottom ?? [];
  const bottomOpenings = bottom.chunk.openings.top ?? [];

  let hallwayCol: number;

  if (topOpenings.length > 0 && bottomOpenings.length > 0) {
    let bestDist = Infinity;
    let bestTopCol = topOpenings[0];
    let bestBottomCol = bottomOpenings[0];
    for (const tc of topOpenings) {
      for (const bc of bottomOpenings) {
        const topMapCol = top.tileX + tc;
        const bottomMapCol = bottom.tileX + bc;
        const dist = Math.abs(topMapCol - bottomMapCol);
        if (dist < bestDist) {
          bestDist = dist;
          bestTopCol = tc;
          bestBottomCol = bc;
        }
      }
    }
    const topMapCol = top.tileX + bestTopCol;
    const bottomMapCol = bottom.tileX + bestBottomCol;
    hallwayCol = Math.round((topMapCol + bottomMapCol) / 2);

    const startRow = top.tileY + top.chunk.height;
    const endRow = bottom.tileY;

    for (let r = startRow - 1; r <= endRow; r++) {
      if (r >= 0 && r < MAP_HEIGHT && hallwayCol >= 0 && hallwayCol < MAP_WIDTH) {
        if (tiles[r][hallwayCol] === TileType.Wall) {
          tiles[r][hallwayCol] = TileType.Floor;
        }
      }
    }

    // L-shaped connections if columns don't align
    if (topMapCol !== hallwayCol) {
      const row = startRow - 1;
      const minC = Math.min(topMapCol, hallwayCol);
      const maxC = Math.max(topMapCol, hallwayCol);
      for (let c = minC; c <= maxC; c++) {
        if (tiles[row][c] === TileType.Wall) {
          tiles[row][c] = TileType.Floor;
        }
      }
    }
    if (bottomMapCol !== hallwayCol) {
      const row = endRow;
      const minC = Math.min(bottomMapCol, hallwayCol);
      const maxC = Math.max(bottomMapCol, hallwayCol);
      for (let c = minC; c <= maxC; c++) {
        if (tiles[row][c] === TileType.Wall) {
          tiles[row][c] = TileType.Floor;
        }
      }
    }
  } else {
    const midCol = Math.round((top.centerX + bottom.centerX) / 2);
    hallwayCol = midCol;

    const startRow = top.tileY + top.chunk.height;
    const endRow = bottom.tileY;

    for (let r = startRow - 1; r <= endRow; r++) {
      if (r >= 0 && r < MAP_HEIGHT && hallwayCol >= 0 && hallwayCol < MAP_WIDTH) {
        if (tiles[r][hallwayCol] === TileType.Wall) {
          tiles[r][hallwayCol] = TileType.Floor;
        }
      }
    }

    carveIntoRoom(tiles, top, hallwayCol, "bottom");
    carveIntoRoom(tiles, bottom, hallwayCol, "top");
  }

  // Place door tiles at connection boundaries
  const doorRow1 = top.tileY + top.chunk.height - 1;
  const doorRow2 = bottom.tileY;
  if (tiles[doorRow1][hallwayCol] === TileType.Floor) {
    tiles[doorRow1][hallwayCol] = TileType.Door;
  }
  if (tiles[doorRow2][hallwayCol] === TileType.Floor) {
    tiles[doorRow2][hallwayCol] = TileType.Door;
  }
}

/** Carve a path from the hallway into a room when there's no matching opening */
function carveIntoRoom(
  tiles: TileType[][],
  slot: SlotInfo,
  hallwayPos: number, // row for left/right, col for top/bottom
  side: "left" | "right" | "top" | "bottom"
): void {
  if (side === "right") {
    // Carve from right edge inward at hallwayPos (row)
    const col = slot.tileX + slot.chunk.width - 1;
    if (tiles[hallwayPos][col] === TileType.Wall) {
      tiles[hallwayPos][col] = TileType.Floor;
    }
  } else if (side === "left") {
    const col = slot.tileX;
    if (tiles[hallwayPos][col] === TileType.Wall) {
      tiles[hallwayPos][col] = TileType.Floor;
    }
  } else if (side === "bottom") {
    const row = slot.tileY + slot.chunk.height - 1;
    if (tiles[row][hallwayPos] === TileType.Wall) {
      tiles[row][hallwayPos] = TileType.Floor;
    }
  } else if (side === "top") {
    const row = slot.tileY;
    if (tiles[row][hallwayPos] === TileType.Wall) {
      tiles[row][hallwayPos] = TileType.Floor;
    }
  }
}

function ensureConnectivity(
  filledSet: Set<string>,
  lobbySlot: { col: number; row: number },
): void {
  const visited = new Set<string>();
  const queue: string[] = [`${lobbySlot.col},${lobbySlot.row}`];
  visited.add(queue[0]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const [col, row] = current.split(",").map(Number);

    const neighbors = [
      { col: col - 1, row },
      { col: col + 1, row },
      { col, row: row - 1 },
      { col, row: row + 1 },
    ];

    for (const n of neighbors) {
      const key = `${n.col},${n.row}`;
      if (!visited.has(key) && filledSet.has(key)) {
        visited.add(key);
        queue.push(key);
      }
    }
  }

  // If some filled slots are unreachable, add bridge slots
  const unreachable = new Set<string>();
  for (const key of filledSet) {
    if (!visited.has(key)) {
      unreachable.add(key);
    }
  }

  if (unreachable.size > 0) {
    // Try to bridge by adding intermediate slots
    for (const uKey of unreachable) {
      const [uc, ur] = uKey.split(",").map(Number);

      // Find the nearest reachable slot
      let bestDist = Infinity;
      let bestKey = "";
      for (const vKey of visited) {
        const [vc, vr] = vKey.split(",").map(Number);
        const dist = Math.abs(uc - vc) + Math.abs(ur - vr);
        if (dist < bestDist) {
          bestDist = dist;
          bestKey = vKey;
        }
      }

      if (bestKey) {
        const [bc, br] = bestKey.split(",").map(Number);
        // Add intermediate slots along the path
        let cc = bc;
        let cr = br;
        while (cc !== uc || cr !== ur) {
          if (cc < uc) cc++;
          else if (cc > uc) cc--;
          else if (cr < ur) cr++;
          else if (cr > ur) cr--;
          const newKey = `${cc},${cr}`;
          filledSet.add(newKey);
          visited.add(newKey);
        }
      }
    }
  }
}

function generatePatrolWaypoints(
  rng: SeededRandom,
  guardRoom: SlotInfo,
  allSlots: SlotInfo[],
  slotMap: Map<string, SlotInfo>,
  tiles: TileType[][]
): Array<{ x: number; y: number }> {
  // Build a patrol route through 3-5 adjacent rooms
  const numWaypoints = rng.nextInt(3, 5);
  const visited = new Set<string>();
  const route: SlotInfo[] = [guardRoom];
  visited.add(`${guardRoom.col},${guardRoom.row}`);

  let current = guardRoom;
  for (let i = 1; i < numWaypoints; i++) {
    const neighbors: SlotInfo[] = [];
    const dirs = [
      { col: current.col - 1, row: current.row },
      { col: current.col + 1, row: current.row },
      { col: current.col, row: current.row - 1 },
      { col: current.col, row: current.row + 1 },
    ];
    for (const d of dirs) {
      const key = `${d.col},${d.row}`;
      const slot = slotMap.get(key);
      if (slot && !visited.has(key)) {
        neighbors.push(slot);
      }
    }

    if (neighbors.length === 0) break;
    const next = rng.pick(neighbors);
    route.push(next);
    visited.add(`${next.col},${next.row}`);
    current = next;
  }

  // Create waypoints at each room's center (finding actual floor tiles)
  const waypoints: Array<{ x: number; y: number }> = [];
  for (const slot of route) {
    const pos = findFloorTileNear(tiles, slot.centerX, slot.centerY);
    waypoints.push(pos);
  }

  // Make it a loop by adding the route in reverse (minus first and last)
  if (route.length >= 3) {
    for (let i = route.length - 2; i >= 1; i--) {
      const pos = findFloorTileNear(tiles, route[i].centerX, route[i].centerY);
      waypoints.push(pos);
    }
  }

  return waypoints;
}

function findFloorTileNear(tiles: TileType[][], x: number, y: number): { x: number; y: number } {
  // Check the target tile first — must be a walkable, non-special tile
  if (
    y >= 0 && y < tiles.length &&
    x >= 0 && x < (tiles[0]?.length ?? 0) &&
    tiles[y][x] === TileType.Floor
  ) {
    return { x, y };
  }

  // Spiral search outward for a Floor tile
  for (let radius = 1; radius <= 5; radius++) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        const ny = y + dr;
        const nx = x + dc;
        if (
          ny >= 0 && ny < tiles.length &&
          nx >= 0 && nx < (tiles[0]?.length ?? 0) &&
          tiles[ny][nx] === TileType.Floor
        ) {
          return { x: nx, y: ny };
        }
      }
    }
  }

  // Wider fallback search (radius up to 10)
  for (let radius = 6; radius <= 10; radius++) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        const ny = y + dr;
        const nx = x + dc;
        if (
          ny >= 0 && ny < tiles.length &&
          nx >= 0 && nx < (tiles[0]?.length ?? 0) &&
          tiles[ny][nx] === TileType.Floor
        ) {
          return { x: nx, y: ny };
        }
      }
    }
  }

  // Last resort — should not happen with valid maps
  return { x, y };
}

function floodFill(tiles: TileType[][], startX: number, startY: number): Set<string> {
  const visited = new Set<string>();
  const queue: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];
  visited.add(`${startX},${startY}`);

  while (queue.length > 0) {
    const { x, y } = queue.shift()!;
    const neighbors = [
      { x: x - 1, y },
      { x: x + 1, y },
      { x, y: y - 1 },
      { x, y: y + 1 },
    ];

    for (const n of neighbors) {
      const key = `${n.x},${n.y}`;
      if (visited.has(key)) continue;
      if (n.y < 0 || n.y >= tiles.length || n.x < 0 || n.x >= (tiles[0]?.length ?? 0)) continue;
      if (tiles[n.y][n.x] === TileType.Wall) continue;
      visited.add(key);
      queue.push(n);
    }
  }

  return visited;
}
