// Full 64-hexagram catalog — King Wen order, assembled from 8-entry chunk files.
// Chunking keeps each file reviewable; this index is the only assembly point.

import type { HexagramEntry } from '../schema'
import { HEXAGRAMS_01_08 } from './hexagrams-01-08'
import { HEXAGRAMS_09_16 } from './hexagrams-09-16'
import { HEXAGRAMS_17_24 } from './hexagrams-17-24'
import { HEXAGRAMS_25_32 } from './hexagrams-25-32'
import { HEXAGRAMS_33_40 } from './hexagrams-33-40'
import { HEXAGRAMS_41_48 } from './hexagrams-41-48'
import { HEXAGRAMS_49_56 } from './hexagrams-49-56'
import { HEXAGRAMS_57_64 } from './hexagrams-57-64'

export const HEXAGRAMS: HexagramEntry[] = [
  ...HEXAGRAMS_01_08,
  ...HEXAGRAMS_09_16,
  ...HEXAGRAMS_17_24,
  ...HEXAGRAMS_25_32,
  ...HEXAGRAMS_33_40,
  ...HEXAGRAMS_41_48,
  ...HEXAGRAMS_49_56,
  ...HEXAGRAMS_57_64,
]
