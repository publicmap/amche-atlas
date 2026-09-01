import './polyfills.js'
import { parquetMetadataAsync, parquetReadObjects } from 'hyparquet'
import { decompress as decompressZstd } from 'fzstd'
import levenshtein from 'fast-levenshtein'

globalThis.HyparquetLib = {
  parquetMetadataAsync,
  parquetReadObjects,
  compressors: {
    ZSTD: input => decompressZstd(input),
  },
  levenshteinGet: (a, b) => levenshtein.get(a, b),
}
