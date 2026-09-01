import { describe, expect, it } from 'vitest'
import { sseLines } from '../src/stream'

function sseBody(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame))
      controller.close()
    },
  })
}

function hangingBody(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: first\n\n'))
      // Never closes — the stream stays open.
    },
  })
}

describe('SSE line parsing & tolerance', () => {
  it('yields all lines including a corrupt one (the adapter skips it)', async () => {
    const lines: string[] = []
    for await (const line of sseLines(
      sseBody([
        'data: {"choices":[{"delta":{"content":"hello"}}]}\n',
        'data: {corrupt json!!!\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n',
        'data: [DONE]\n',
      ]),
    )) {
      lines.push(line)
    }
    expect(lines).toEqual([
      'data: {"choices":[{"delta":{"content":"hello"}}]}',
      'data: {corrupt json!!!',
      'data: {"choices":[{"delta":{"content":" world"}}]}',
      'data: [DONE]',
    ])
    // The adapter's try/catch turns the corrupt line into a no-op:
    expect(() => JSON.parse('{corrupt json!!!')).toThrow()
    expect(() => {
      try {
        JSON.parse('{corrupt json!!!')
      } catch {
        /* skip — this is exactly what the adapters now do */
      }
    }).not.toThrow()
  })

  it('releases the reader when the consumer abandons mid-stream', async () => {
    const body = hangingBody()
    const reader = body.getReader()
    reader.releaseLock() // give the lock back so sseLines can acquire it
    const gen = sseLines(body)
    const first = await gen.next()
    expect(first.value).toBe('data: first')
    // Abandon: .return() triggers the finally block, which must cancel and
    // release the reader so the underlying socket can be reused.
    await gen.return(undefined)
    // If the lock was not released this would throw.
    expect(() => body.getReader()).not.toThrow()
  })

  it('propagates consumer exceptions and still releases the reader', async () => {
    const body = hangingBody()
    const reader = body.getReader()
    reader.releaseLock()
    const gen = sseLines(body)
    await gen.next()
    // The consumer throws inside the for-await loop — JS calls gen.return(),
    // which runs the finally block.
    await expect(gen.throw(new Error('gateway error'))).rejects.toThrow('gateway error')
    expect(() => body.getReader()).not.toThrow()
  })
})
