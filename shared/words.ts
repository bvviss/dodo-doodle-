// Built-in word packs.
//
// HOW TO ADD WORDS: find the pack below and add a line like  "giraffe",
// inside the `easy` or `hard` list (keep the quotes and the comma).
// Easy = simple single things. Hard = trickier ideas or short phrases.
// Each word must be 60 characters or fewer.

import type { Difficulty, PackId } from "./types";

export interface WordPack {
  id: PackId;
  name: string;
  emoji: string;
  easy: string[];
  hard: string[];
}

export const PACKS: WordPack[] = [
  {
    id: "animals",
    name: "Animals",
    emoji: "🐘",
    easy: [
      "cat", "dog", "elephant", "giraffe", "lion", "tiger", "monkey", "fish", "snake", "frog",
      "duck", "cow", "pig", "horse", "rabbit", "bird", "turtle", "shark", "whale", "octopus",
      "spider", "butterfly", "bee", "snail", "penguin", "owl", "crab", "mouse", "bear", "zebra",
      "chicken", "kangaroo", "crocodile", "dolphin", "sheep",
    ],
    hard: [
      "orangutan", "platypus", "chameleon", "jellyfish", "seahorse", "hammerhead shark",
      "flamingo on one leg", "sleepy sloth", "angry goose", "hermit crab", "porcupine",
      "peacock showing off", "pangolin", "hornbill", "mosquito", "tapir", "koala hugging a tree",
    ],
  },
  {
    id: "food",
    name: "Food",
    emoji: "🍜",
    easy: [
      "pizza", "burger", "banana", "apple", "ice cream", "cake", "egg", "bread", "cheese", "carrot",
      "hot dog", "donut", "watermelon", "noodles", "rice", "cookie", "sandwich", "popcorn", "grapes", "lemon",
      "strawberry", "pineapple", "chocolate", "french fries", "sushi", "coconut", "corn", "mango",
      "durian", "satay", "nasi lemak", "roti canai", "teh tarik", "rambutan", "curry puff",
    ],
    hard: [
      "spaghetti meatballs", "birthday cake", "bubble tea", "char kway teow", "cendol", "ice kacang",
      "laksa", "kaya toast", "chicken rice", "fried egg on toast", "ais kacang melting", "milo dinosaur",
      "durian stinking up a car", "dim sum", "pancake stack", "nasi kandar", "rendang",
    ],
  },
  {
    id: "objects",
    name: "Objects",
    emoji: "☂️",
    easy: [
      "umbrella", "chair", "table", "phone", "lamp", "clock", "book", "key", "glasses", "shoe",
      "hat", "ball", "car", "bicycle", "boat", "plane", "house", "tree", "flower", "sun",
      "moon", "star", "candle", "guitar", "camera", "toothbrush", "scissors", "pencil", "television", "bed",
      "kite", "balloon", "door", "cup", "bucket",
    ],
    hard: [
      "traffic light", "washing machine", "rocket ship", "hot air balloon", "roller coaster",
      "remote control", "electric fan", "rice cooker", "treasure chest", "magnifying glass",
      "vending machine", "broken umbrella", "lava lamp", "ceiling fan", "shopping trolley", "ferris wheel",
    ],
  },
  {
    id: "actions",
    name: "Actions",
    emoji: "🏃",
    easy: [
      "running", "jumping", "sleeping", "swimming", "dancing", "singing", "eating", "crying", "laughing", "reading",
      "cooking", "fishing", "climbing", "flying", "sneezing", "waving", "kicking", "throwing", "painting", "writing",
      "driving", "skating", "surfing", "yawning", "hugging", "clapping", "falling", "shouting", "digging", "sweeping",
    ],
    hard: [
      "brushing teeth", "taking a selfie", "walking the dog", "missing the bus", "slipping on a banana",
      "doing push-ups", "blowing bubbles", "making a wish", "tying shoelaces", "losing the remote",
      "stuck in traffic", "sleepwalking", "playing hide and seek", "doing laundry", "parallel parking",
      "bargaining at a market",
    ],
  },
  {
    id: "places",
    name: "Places",
    emoji: "🏝️",
    easy: [
      "beach", "school", "hospital", "farm", "zoo", "park", "kitchen", "bathroom", "library", "airport",
      "castle", "island", "mountain", "desert", "jungle", "volcano", "city", "bridge", "river", "cave",
      "shop", "cinema", "pool", "church", "temple", "mosque", "museum", "stadium", "garden", "lighthouse",
      "mamak stall", "night market", "petrol station",
    ],
    hard: [
      "Petronas Twin Towers", "Batu Caves", "Mount Kinabalu", "rice field", "haunted house",
      "underwater city", "space station", "traffic jam", "wet market", "shopping mall",
      "kopitiam", "train station at rush hour", "theme park", "camping site", "Penang street art",
      "LRT station", "pasar malam",
    ],
  },
  {
    id: "jobs",
    name: "Jobs",
    emoji: "👩‍🚒",
    easy: [
      "doctor", "nurse", "teacher", "chef", "farmer", "pilot", "police officer", "firefighter", "astronaut", "artist",
      "dentist", "baker", "builder", "clown", "magician", "singer", "dancer", "waiter", "driver", "fisherman",
      "scientist", "king", "queen", "pirate", "ninja", "cowboy", "soldier", "gardener", "vet", "mechanic",
      "barber", "postman", "lifeguard",
    ],
    hard: [
      "lawyer", "plumber", "librarian", "zookeeper", "detective", "news reporter", "lion tamer",
      "deep sea diver", "beekeeper", "referee", "fortune teller", "delivery rider", "taxi driver",
      "personal trainer", "influencer", "teh tarik maker", "air traffic controller",
    ],
  },
  {
    id: "silly",
    name: "Silly phrases",
    emoji: "🤪",
    easy: [],
    hard: [
      "a cat doing taxes", "a dog driving a bus", "a shark at the dentist", "a penguin on holiday",
      "a banana with sunglasses", "a ghost eating noodles", "grandma on a skateboard", "a cow in space",
      "a snowman at the beach", "a dinosaur at a birthday party", "a robot learning to dance",
      "a pizza delivering a pizza", "an octopus playing drums", "a frog wearing a crown",
      "a giraffe in a tiny car", "a durian in love", "an elephant hiding behind a tree",
      "a chicken crossing the road", "a monkey taking a selfie", "a vampire at the dentist",
      "a teapot having a bad day", "a hamster lifting weights", "a cactus giving a hug",
      "a superhero doing laundry", "an alien buying groceries", "a goldfish in a submarine",
      "a cat stuck in a tree", "a pirate at a mamak stall", "a toaster that hates bread",
      "a horse riding a bicycle", "a sleepy volcano", "a ninja in a library",
      "a bear at a night market", "a sheep counting humans",
    ],
  },
];

export function packById(id: PackId): WordPack | undefined {
  return PACKS.find((p) => p.id === id);
}

/** Every built-in word for the chosen packs and difficulty (deduplicated). */
export function wordsFor(packs: PackId[], difficulty: Difficulty): string[] {
  const out = new Set<string>();
  for (const id of packs) {
    const pack = packById(id);
    if (!pack) continue;
    const lists =
      difficulty === "easy" ? [pack.easy] : difficulty === "hard" ? [pack.hard] : [pack.easy, pack.hard];
    // A pack with no easy words (Silly phrases) still contributes on Easy.
    if (difficulty === "easy" && pack.easy.length === 0) lists.push(pack.hard);
    for (const list of lists) for (const w of list) out.add(w);
  }
  return [...out];
}

/** Simple words used when a player doesn't write a prompt in time, and by bots. */
export function fallbackWords(): string[] {
  return wordsFor(
    PACKS.filter((p) => p.easy.length > 0).map((p) => p.id),
    "easy",
  );
}
