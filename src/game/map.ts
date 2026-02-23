export enum TileType {
  Floor = 0,
  Wall = 1,
  Door = 2,
  HideSpot = 3,
  ItemSpawn = 4,
  Exit = 5,
  GuardSpawn = 6,
  Camera = 7,
}

const W = TileType.Wall;
const F = TileType.Floor;
const D = TileType.Door;
const H = TileType.HideSpot;
const I = TileType.ItemSpawn;
const E = TileType.Exit;
const G = TileType.GuardSpawn;
const C = TileType.Camera;

/**
 * Test map: ~20x16 apartment layout
 *
 * WWWWWWWWWWWWWWWWWWWW
 * W......W...W......W
 * W......W...W......W
 * W......D...D......W
 * W......W...W......W
 * WWWWDWWW...WWWDWWWW
 * W......W...W......W
 * W..H...W.C.W...I..W
 * W......W...W......W
 * W......D...D......W
 * WWWWWWWW...WWWWWWWW
 * W..................W
 * W........G.........W  (note: map is 20 wide, this row also 20)
 * W..................W
 * W.....E............W
 * WWWWWWWWWWWWWWWWWWWW
 */
export const FALLBACK_MAP: TileType[][] = [
  [W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W],
  [W, F, F, F, F, F, F, W, F, F, F, W, F, F, F, F, F, F, F, W],
  [W, F, F, F, F, F, F, W, F, F, F, W, F, F, F, F, F, F, F, W],
  [W, F, F, F, F, F, F, D, F, F, F, D, F, F, F, F, F, F, F, W],
  [W, F, F, F, F, F, F, W, F, F, F, W, F, F, F, F, F, F, F, W],
  [W, W, W, W, D, W, W, W, F, F, F, W, W, W, D, W, W, W, W, W],
  [W, F, F, F, F, F, F, W, F, F, F, W, F, F, F, F, F, F, F, W],
  [W, F, F, H, F, F, F, W, F, C, F, W, F, F, F, F, F, I, F, W],
  [W, F, F, F, F, F, F, W, F, F, F, W, F, F, F, F, F, F, F, W],
  [W, F, F, F, F, F, F, D, F, F, F, D, F, F, F, F, F, F, F, W],
  [W, W, W, W, W, W, W, W, F, F, F, W, W, W, W, W, W, W, W, W],
  [W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W],
  [W, F, F, F, F, F, F, F, F, G, F, F, F, F, F, F, F, F, F, W],
  [W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W],
  [W, F, F, F, F, F, E, F, F, F, F, F, F, F, F, F, F, F, F, W],
  [W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W],
];

export function getTile(map: TileType[][], col: number, row: number): TileType {
  if (row < 0 || row >= map.length || col < 0 || col >= (map[0]?.length ?? 0)) {
    return TileType.Wall;
  }
  return map[row][col];
}

export function isWalkable(map: TileType[][], col: number, row: number): boolean {
  const tile = getTile(map, col, row);
  return tile !== TileType.Wall;
}

export function getMapWidth(map: TileType[][]): number {
  return map[0]?.length ?? 0;
}

export function getMapHeight(map: TileType[][]): number {
  return map.length;
}
