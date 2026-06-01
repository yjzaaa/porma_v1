/**
 * 语音模块 — PCM 音频工具函数
 *
 * 提供音频数据格式转换、缓冲合并和分片等底层操作。
 * 所有函数为纯函数，无副作用。
 */

/** 目标采样率：16000 Hz（豆包 ASR 要求的输入格式） */
export const TARGET_SAMPLE_RATE = 16000

/** 单帧分片字节数：16000 Hz × 2 bytes × 0.2s = 6400 bytes（200ms 音频块） */
export const CHUNK_BYTES = TARGET_SAMPLE_RATE * 2 * 0.2

/**
 * Float32 音频采样 → 16-bit PCM ArrayBuffer
 *
 * 自动降采样到 TARGET_SAMPLE_RATE（16000 Hz）。
 * 多采样点通过取均值合并，减少混叠。
 *
 * @param samples - 输入 Float32Array（值范围 -1 ~ 1）
 * @param inputSampleRate - 输入采样率（如 48000）
 * @returns 16-bit PCM 数据（小端序 Int16）
 *
 * 示例：48000 Hz 输入 → ratio=3 → 每 3 个采样点合并为 1 个输出值
 */
export function floatTo16BitPcm(samples: Float32Array, inputSampleRate: number): ArrayBuffer {
  const ratio = inputSampleRate / TARGET_SAMPLE_RATE
  const outputLength = Math.floor(samples.length / ratio)
  const buffer = new ArrayBuffer(outputLength * 2)
  const view = new DataView(buffer)

  for (let i = 0; i < outputLength; i += 1) {
    const start = Math.floor(i * ratio)
    const end = Math.min(Math.floor((i + 1) * ratio), samples.length)
    let sum = 0
    for (let j = start; j < end; j += 1) {
      sum += samples[j] ?? 0
    }
    // 均值归一化 + 钳位 + 转 16-bit 有符号整数
    const sample = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)))
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }

  return buffer
}

/**
 * 合并多个 ArrayBuffer 为一个连续 buffer
 *
 * @param buffers - ArrayBuffer 数组
 * @returns 合并后的单一 ArrayBuffer
 */
export function concatAudioBuffers(buffers: ArrayBuffer[]): ArrayBuffer {
  const total = buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0)
  const output = new Uint8Array(total)
  let offset = 0
  for (const buffer of buffers) {
    output.set(new Uint8Array(buffer), offset)
    offset += buffer.byteLength
  }
  return output.buffer
}

/**
 * 从 buffer 头部切分出固定大小的块，剩余部分返回
 *
 * @param buffer - 源 buffer
 * @param size - 分片大小（字节）
 * @returns chunk-分片（不足 size 时为 null），rest-剩余部分
 */
export function splitChunk(buffer: ArrayBuffer, size: number): { chunk: ArrayBuffer | null; rest: ArrayBuffer } {
  if (buffer.byteLength < size) return { chunk: null, rest: buffer }
  return {
    chunk: buffer.slice(0, size),
    rest: buffer.slice(size),
  }
}
