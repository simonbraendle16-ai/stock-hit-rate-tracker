import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { versionFromHeader } from './assistant-api'

describe('assistant API version header', () => {
  it('accepts the application version header used behind Vercel', () => {
    const request = new NextRequest('https://example.test/api/assistant/v1/journal/x', {
      headers: { 'X-Expected-Version': '3' },
    })
    expect(versionFromHeader(request)).toBe(3)
  })

  it('requires a positive integer version', () => {
    const request = new NextRequest('https://example.test/api/assistant/v1/journal/x', {
      headers: { 'X-Expected-Version': '0' },
    })
    expect(() => versionFromHeader(request)).toThrow('X-Expected-Version')
  })
})
