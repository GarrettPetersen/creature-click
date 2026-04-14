/**
 * Curated Commons files (kid-friendly labels). Random Commons search is unsafe for young kids.
 * Titles are normalized by the API (spaces, capitalization).
 */
export const CREATURES = [
  { name: 'Red panda', file: 'Red Panda.JPG' },
  { name: 'Lion', file: 'Lion waiting in Namibia.jpg' },
  { name: 'Elephant', file: 'African elephant.jpg' },
  { name: 'Tiger', file: 'Bengal tiger.jpg' },
  { name: 'Owl', file: 'Eurasian eagle-owl (44088).jpg' },
  { name: 'Penguin', file: 'Emperor Penguin Manchot empereur.jpg' },
  { name: 'Giraffe', file: 'Giraffe standing.jpg' },
  { name: 'Dolphin', file: 'Common dolphin.jpg' },
  { name: 'Koala', file: 'Koala climbing tree.jpg' },
  { name: 'Zebra', file: 'Plains Zebra Equus quagga.jpg' },
  { name: 'Polar bear', file: 'Polar bear.jpg' },
  { name: 'Hedgehog', file: 'Erinaceus europaeus LC0119.jpg' },
  { name: 'Sea turtle', file: 'Green sea turtle.jpg' },
  { name: 'Butterfly', file: 'Monarch In May.jpg' },
  { name: 'Parrot', file: 'Scarlet macaw.jpg' },
  { name: 'Sea otter', file: 'Sea otter cropped.jpg' },
  { name: 'Tree frog', file: 'Agalychnis callidryas.jpg' },
  { name: 'Flamingo', file: 'Greater flamingo.jpg' },
  { name: 'Wolf', file: 'Gray wolf.jpg' },
  { name: 'Rabbit', file: 'Eastern cottontail.jpg' },
];

export function pickRandomCreature(excludeFile = null) {
  const pool = excludeFile
    ? CREATURES.filter((c) => c.file !== excludeFile)
    : CREATURES;
  const list = pool.length ? pool : CREATURES;
  return list[Math.floor(Math.random() * list.length)];
}
