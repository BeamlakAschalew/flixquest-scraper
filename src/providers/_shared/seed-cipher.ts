interface CipherState {
  values: number[]
  accumulator: number
}

const GOLDEN_RATIO = 0x9e3779b9
const PAYLOAD_MAGIC = new Uint8Array([0x6d, 0x76, 0x6d, 0x31])

function mix32(value: number): number {
  value >>>= 0
  value ^= value >>> 16
  value = Math.imul(value, 0x85ebca6b) >>> 0
  value ^= value >>> 13
  value = Math.imul(value, 0xc2b2ae35) >>> 0
  value ^= value >>> 16
  return value >>> 0
}

function rotateLeft(value: number, shift: number): number {
  value >>>= 0
  shift &= 31
  return shift === 0
    ? value
    : ((value << shift) | (value >>> (32 - shift))) >>> 0
}

function fnvHash(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x1000193) >>> 0
  }
  return mix32(hash)
}

function initializeCipher(seed: string, mediaId: number): CipherState {
  if (!seed) throw new Error('Seed payload used an empty seed')

  const values = new Array<number>(61)
  let accumulator = mix32(
    (fnvHash(seed) ^ mix32((mediaId ^ GOLDEN_RATIO) >>> 0)) >>> 0
  )

  for (let round = 0; round < 8; round++) {
    const index = accumulator % values.length
    accumulator = rotateLeft(
      (accumulator + GOLDEN_RATIO) >>> 0,
      7 + (round & 7)
    )
    values[index] = (accumulator ^ mix32(accumulator)) >>> 0
    accumulator = mix32((accumulator + index) >>> 0)
  }

  return {
    values,
    accumulator: mix32((accumulator ^ 0xa5a5a5a5) >>> 0),
  }
}

function nextCipherWord(state: CipherState, counter: number): number {
  const index = state.accumulator % state.values.length
  const initializedMask = index in state.values ? -1 : 0
  const value = state.values[index] >>> 0
  const counterValue = Math.imul(GOLDEN_RATIO, counter + 1) >>> 0
  const combined =
    ((state.accumulator ^ (value ^ counterValue)) |
      (state.accumulator & (value ^ counterValue) & initializedMask)) >>>
    0

  const word =
    (rotateLeft((combined + state.accumulator) >>> 0, index & 31) ^
      rotateLeft(state.accumulator, Math.imul(index, 7) & 31)) >>>
    0

  state.accumulator = mix32((word + GOLDEN_RATIO) >>> 0)
  state.values[index] = state.accumulator
  return state.accumulator
}

function createKeystream(
  seed: string,
  mediaId: number,
  length: number
): Uint8Array {
  const state = initializeCipher(seed, mediaId)
  const output = new Uint8Array(length)
  let counter = 0

  for (let index = 0; index < length; ) {
    const word = nextCipherWord(state, counter++)
    output[index++] = word & 0xff
    if (index < length) output[index++] = (word >>> 8) & 0xff
    if (index < length) output[index++] = (word >>> 16) & 0xff
    if (index < length) output[index++] = (word >>> 24) & 0xff
  }

  return output
}

export function decodeSeedPayload<T>(
  encryptedText: string,
  seed: string,
  mediaId: number
): T {
  const encrypted = new Uint8Array(
    Buffer.from(
      encryptedText.trim().replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    )
  )
  const keystream = createKeystream(seed, mediaId, encrypted.length)

  for (let index = 0; index < encrypted.length; index++) {
    encrypted[index] ^= keystream[index]
  }

  if (
    encrypted.length < PAYLOAD_MAGIC.length ||
    PAYLOAD_MAGIC.some((byte, index) => encrypted[index] !== byte)
  ) {
    throw new Error('Seed payload signature mismatch')
  }

  const json = new TextDecoder('utf-8', { fatal: true }).decode(
    encrypted.subarray(PAYLOAD_MAGIC.length)
  )
  const payload: unknown = JSON.parse(json)
  if (!payload || typeof payload !== 'object') {
    throw new Error('Seed endpoint returned an invalid payload')
  }
  return payload as T
}

export function encodeSeedPayload(
  payload: unknown,
  seed: string,
  mediaId: number
): string {
  const json = new TextEncoder().encode(JSON.stringify(payload))
  const plain = new Uint8Array(PAYLOAD_MAGIC.length + json.length)
  plain.set(PAYLOAD_MAGIC)
  plain.set(json, PAYLOAD_MAGIC.length)
  const keystream = createKeystream(seed, mediaId, plain.length)

  for (let index = 0; index < plain.length; index++) {
    plain[index] ^= keystream[index]
  }

  return Buffer.from(plain).toString('base64url')
}
