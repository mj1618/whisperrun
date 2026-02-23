import { TileType } from "@/game/map";

const W = TileType.Wall;
const F = TileType.Floor;
const H = TileType.HideSpot;
const C = TileType.Camera;

export interface RoomChunk {
  name: string;
  tiles: TileType[][];
  width: number; // cols
  height: number; // rows
  /** Edges that have an opening. "top"/"bottom" = column indices, "left"/"right" = row indices. */
  openings: {
    top?: number[];
    bottom?: number[];
    left?: number[];
    right?: number[];
  };
  guardSpawns?: Array<{ x: number; y: number }>;
  hideSpots?: Array<{ x: number; y: number }>;
  cameraSpots?: Array<{ x: number; y: number; facing?: "up" | "down" | "left" | "right" }>;
  itemSpots?: Array<{ x: number; y: number }>;
}

// 1. Office (9x7) — desk rows, hide spot, camera. Openings left & right.
const OFFICE: RoomChunk = {
  name: "Office",
  width: 9,
  height: 7,
  tiles: [
    [W, W, W, W, W, W, W, W, W],
    [W, F, F, F, F, F, F, F, W],
    [W, F, W, F, F, F, W, F, W],
    [F, F, F, F, F, F, F, F, F], // left & right openings row 3
    [W, F, W, F, F, F, W, F, W],
    [W, F, F, F, H, F, F, C, W],
    [W, W, W, W, W, W, W, W, W],
  ],
  openings: {
    left: [3],
    right: [3],
  },
  guardSpawns: [{ x: 4, y: 2 }],
  hideSpots: [{ x: 4, y: 5 }],
  cameraSpots: [{ x: 7, y: 5, facing: "left" }],
  itemSpots: [{ x: 4, y: 4 }],
};

// 2. Hallway Horizontal (9x5) — narrow corridor, openings on left, right, and one side.
const HALLWAY_H: RoomChunk = {
  name: "Hallway H",
  width: 9,
  height: 5,
  tiles: [
    [W, W, W, W, F, W, W, W, W], // top opening col 4
    [W, F, F, F, F, F, F, F, W],
    [F, F, F, F, F, F, F, F, F], // left & right openings row 2
    [W, F, F, F, F, F, F, F, W],
    [W, W, W, W, W, W, W, W, W],
  ],
  openings: {
    left: [2],
    right: [2],
    top: [4],
  },
  guardSpawns: [{ x: 4, y: 2 }],
};

// 3. Hallway Vertical (5x9) — narrow corridor, openings top, bottom, and one side.
const HALLWAY_V: RoomChunk = {
  name: "Hallway V",
  width: 5,
  height: 9,
  tiles: [
    [W, W, F, W, W], // top opening col 2
    [W, F, F, F, W],
    [W, F, F, F, W],
    [W, F, F, F, W],
    [W, F, F, F, F], // right opening row 4
    [W, F, F, F, W],
    [W, F, F, F, W],
    [W, F, F, F, W],
    [W, W, F, W, W], // bottom opening col 2
  ],
  openings: {
    top: [2],
    bottom: [2],
    right: [4],
  },
  guardSpawns: [{ x: 2, y: 4 }],
};

// 4. Storage Room (7x7) — shelving aisles, two hide spots, one item spot.
const STORAGE: RoomChunk = {
  name: "Storage",
  width: 7,
  height: 7,
  tiles: [
    [W, W, W, F, W, W, W], // top opening col 3
    [W, F, F, F, F, F, W],
    [W, W, F, F, F, W, W],
    [W, F, F, F, F, F, W],
    [W, W, F, F, F, W, W],
    [W, H, F, F, F, H, W],
    [W, W, W, W, W, W, W],
  ],
  openings: {
    top: [3],
  },
  hideSpots: [
    { x: 1, y: 5 },
    { x: 5, y: 5 },
  ],
  itemSpots: [{ x: 3, y: 3 }],
};

// 5. Living Room (9x9) — larger open room, hide spot, camera, multiple openings.
const LIVING_ROOM: RoomChunk = {
  name: "Living Room",
  width: 9,
  height: 9,
  tiles: [
    [W, W, W, W, F, W, W, W, W], // top opening col 4
    [W, F, F, F, F, F, F, F, W],
    [W, F, F, F, F, F, F, F, W],
    [W, F, F, F, F, F, F, F, F], // right opening row 3
    [W, F, F, F, F, F, F, F, W],
    [F, F, F, F, F, F, W, W, W], // left opening row 5; couch wall stub
    [W, F, H, F, F, F, F, F, W],
    [W, F, F, F, F, F, F, C, W],
    [W, W, W, W, F, W, W, W, W], // bottom opening col 4
  ],
  openings: {
    top: [4],
    bottom: [4],
    left: [5],
    right: [3],
  },
  guardSpawns: [{ x: 4, y: 4 }],
  hideSpots: [{ x: 2, y: 6 }],
  cameraSpots: [{ x: 7, y: 7, facing: "left" }],
  itemSpots: [{ x: 4, y: 2 }],
};

// 6. Kitchen (7x7) — counter islands, one hide spot. Two openings.
const KITCHEN: RoomChunk = {
  name: "Kitchen",
  width: 7,
  height: 7,
  tiles: [
    [W, W, W, W, W, W, W],
    [W, F, F, F, F, F, W],
    [W, F, W, F, W, F, W], // counter islands
    [F, F, F, F, F, F, F], // left & right openings row 3
    [W, F, W, F, W, F, W],
    [W, F, F, H, F, F, W],
    [W, W, W, W, W, W, W],
  ],
  openings: {
    left: [3],
    right: [3],
  },
  hideSpots: [{ x: 3, y: 5 }],
  itemSpots: [{ x: 3, y: 1 }],
};

// 7. Bathroom (5x5) — smallest room, one hide spot, one opening.
const BATHROOM: RoomChunk = {
  name: "Bathroom",
  width: 5,
  height: 5,
  tiles: [
    [W, W, W, W, W],
    [W, F, F, F, W],
    [F, F, F, H, W], // left opening row 2
    [W, F, F, F, W],
    [W, W, W, W, W],
  ],
  openings: {
    left: [2],
  },
  hideSpots: [{ x: 3, y: 2 }],
};

// 8. Server Room (7x7) — server racks, camera, two openings.
const SERVER_ROOM: RoomChunk = {
  name: "Server Room",
  width: 7,
  height: 7,
  tiles: [
    [W, W, W, F, W, W, W], // top opening col 3
    [W, F, F, F, F, F, W],
    [W, W, F, F, F, W, W], // rack stubs
    [W, F, F, F, F, F, W],
    [W, W, F, F, F, W, W],
    [W, C, F, F, F, F, W],
    [W, W, W, F, W, W, W], // bottom opening col 3
  ],
  openings: {
    top: [3],
    bottom: [3],
  },
  cameraSpots: [{ x: 1, y: 5, facing: "right" }],
  itemSpots: [{ x: 3, y: 3 }],
};

// 9. Lobby/Foyer (9x7) — entry room with exit tile. Always placed for Runner spawn.
const LOBBY: RoomChunk = {
  name: "Lobby",
  width: 9,
  height: 7,
  tiles: [
    [W, W, W, W, F, W, W, W, W], // top opening col 4
    [W, F, F, F, F, F, F, F, W],
    [W, F, F, F, F, F, F, F, W],
    [W, F, F, F, F, F, F, F, F], // right opening row 3
    [W, F, F, F, F, F, F, F, W],
    [W, F, F, F, F, F, F, F, W],
    [W, W, W, W, W, W, W, W, W],
  ],
  openings: {
    top: [4],
    right: [3],
  },
};

// 10. Break Room (7x7) — tables, vending machine stubs, one hide spot.
const BREAK_ROOM: RoomChunk = {
  name: "Break Room",
  width: 7,
  height: 7,
  tiles: [
    [W, W, W, W, W, W, W],
    [W, F, F, F, F, W, W], // vending machine stub
    [W, F, F, F, F, F, W],
    [F, F, W, F, W, F, F], // left & right openings row 3; table stubs
    [W, F, F, F, F, F, W],
    [W, F, H, F, F, F, W],
    [W, W, W, W, W, W, W],
  ],
  openings: {
    left: [3],
    right: [3],
  },
  hideSpots: [{ x: 2, y: 5 }],
  itemSpots: [{ x: 3, y: 2 }],
};

/** All room chunk templates (non-lobby). The generator picks from these. */
export const ROOM_CHUNKS: RoomChunk[] = [
  OFFICE,
  HALLWAY_H,
  HALLWAY_V,
  STORAGE,
  LIVING_ROOM,
  KITCHEN,
  BATHROOM,
  SERVER_ROOM,
  BREAK_ROOM,
];

/** The lobby chunk is always placed separately at a fixed slot. */
export const LOBBY_CHUNK: RoomChunk = LOBBY;
