/**
 * 语音模块 — PCM 音频工具函数
 *
 * 提供音频数据格式转换、缓冲合并和分片等底层操作。
 * 所有函数为纯函数，无副作用。
 */

import type { PcmFrame } from '../types/panel'

/** 目标采样率：16000 Hz（豆包 ASR 要求的输入格式） */
export const TARGET_SAMPLE_RATE = 16000

/** 单帧分片字节数：16000 Hz × 2 bytes × 0.2s = 6400 bytes（200ms 音频块） */
export const CHUNK_BYTES = TARGET_SAMPLE_RATE * 2 * 0.2

/**
 * Float32 音频采样 → 16-bit PCM ArrayBuffer
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
    const sample = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)))
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }

  return buffer
}

/**
 * 将采集到的 PCM 帧转换为目标采样率的 16-bit ArrayBuffer。
 */
export function pcmFrameTo16BitBuffer(frame: PcmFrame): ArrayBuffer {
  if (frame.sampleRate <= TARGET_SAMPLE_RATE) {
    const output = new ArrayBuffer(frame.data.byteLength)
    new Uint8Array(output).set(new Uint8Array(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength))
    return output
  }

  const ratio = frame.sampleRate / TARGET_SAMPLE_RATE
  const outputLength = Math.floor(frame.data.length / ratio)
  const buffer = new ArrayBuffer(outputLength * 2)
  const view = new DataView(buffer)

  for (let i = 0; i < outputLength; i += 1) {
    const start = Math.floor(i * ratio)
    const end = Math.min(Math.floor((i + 1) * ratio), frame.data.length)
    let sum = 0
    for (let j = start; j < end; j += 1) {
      sum += frame.data[j] ?? 0
    }
    const sample = sum / Math.max(1, end - start)
    view.setInt16(i * 2, sample, true)
  }

  return buffer
}

/**
 * 合并多个 ArrayBuffer 为一个连续 buffer
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
 */
export function splitChunk(buffer: ArrayBuffer, size: number): { chunk: ArrayBuffer | null; rest: ArrayBuffer } {
  if (buffer.byteLength < size) return { chunk: null, rest: buffer }
  return {
    chunk: buffer.slice(0, size),
    rest: buffer.slice(size),
  }
}
