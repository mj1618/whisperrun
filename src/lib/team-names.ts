const ADJECTIVES = [
  "Sneaky", "Silent", "Shadow", "Velvet", "Nimble",
  "Ghostly", "Crafty", "Stealthy", "Swift", "Midnight",
  "Cosmic", "Lucky", "Daring", "Clever", "Mystic",
  "Fuzzy", "Slippery", "Tiny", "Bold", "Phantom",
];

const NOUNS = [
  "Otters", "Pandas", "Foxes", "Raccoons", "Cats",
  "Owls", "Ferrets", "Badgers", "Penguins", "Bunnies",
  "Hamsters", "Sloths", "Lemurs", "Koalas", "Hedgehogs",
  "Chameleons", "Squirrels", "Capybaras", "Platypuses", "Wombats",
];

export function generateTeamName(roomCode: string): string {
  let hash = 0;
  for (let i = 0; i < roomCode.length; i++) {
    hash = ((hash << 5) - hash + roomCode.charCodeAt(i)) | 0;
  }
  hash = Math.abs(hash);
  const adj = ADJECTIVES[hash % ADJECTIVES.length];
  const noun = NOUNS[Math.floor(hash / ADJECTIVES.length) % NOUNS.length];
  return `${adj} ${noun}`;
}
