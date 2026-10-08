import { describe, expect, it } from 'vitest'

import { buildErrorReport, describeError } from './error-report'

describe('describeError', () => {
  it('names the error and its message', () => {
    expect(describeError(new TypeError('x is undefined'))).toBe('TypeError: x is undefined')
  })

  it('handles thrown strings and objects', () => {
    expect(describeError('plain failure')).toBe('plain failure')
    expect(describeError({ code: 'SERVICE_DOWN' })).toBe('{"code":"SERVICE_DOWN"}')
  })
})

describe('buildErrorReport', () => {
  it('lists version, time, screen, language, error, stack and component stack', () => {
    const error = new Error('boom')
    error.stack = 'Error: boom\n    at Session (session.tsx:12:3)'

    const report = buildErrorReport({
      error,
      componentStack: '\n    at Session\n    at Outlet',
      path: '/sessions/12',
      version: '0.1.18',
      locale: 'fr',
      userAgent: 'WebView2',
      now: new Date('2026-10-08T19:00:00Z'),
    })

    expect(report).toBe(
      [
        'GameRoute 0.1.18',
        'Time: 2026-10-08T19:00:00.000Z',
        'Screen: /sessions/12',
        'Language: fr',
        'User agent: WebView2',
        '',
        'Error: boom',
        '',
        'Error: boom\n    at Session (session.tsx:12:3)',
        '',
        'Component stack:',
        'at Session\n    at Outlet',
      ].join('\n')
    )
  })

  it('leaves out what it does not know', () => {
    const report = buildErrorReport({ error: 'plain failure', now: new Date(0) })

    expect(report).toBe(
      ['GameRoute unknown version', 'Time: 1970-01-01T00:00:00.000Z', '', 'plain failure'].join(
        '\n'
      )
    )
  })
})
