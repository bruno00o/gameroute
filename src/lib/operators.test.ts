import { describe, expect, it } from 'vitest'

import { shortOperatorName } from './operators'

describe('shortOperatorName', () => {
  it.each([
    ['Societe Francaise Du Radiotelephone - SFR SA', 'SFR'],
    ['Orange', 'Orange'],
    ['France Telecom - Orange', 'Orange'],
    ['Free SAS', 'Free'],
    ['Free Mobile SAS', 'Free'],
    ['Bouygues Telecom SA', 'Bouygues'],
    ['RETN Limited', 'RETN'],
    ['Arelion Sweden AB', 'Arelion'],
    ['Telia Company AB', 'Telia'],
    ['Cogent Communications', 'Cogent'],
    ['Zayo Bandwidth', 'Zayo'],
    ['Level 3 Parent, LLC', 'Lumen'],
    ['Microsoft Corporation', 'Microsoft'],
    ['MICROSOFT-CORP-MSN-AS-BLOCK', 'Microsoft'],
    ['AMAZON-02', 'Amazon'],
    ['Cloudflare, Inc.', 'Cloudflare'],
    ['CLOUDFLARENET', 'Cloudflare'],
    ['Google LLC', 'Google'],
    ['Akamai International B.V.', 'Akamai'],
    ['Riot Games, Inc', 'Riot Games'],
    ['Valve Corporation', 'Valve'],
    ['OVH SAS', 'OVHcloud'],
  ])('shortens %s to %s', (raw, short) => {
    expect(shortOperatorName(raw)).toBe(short)
  })

  it('cleans legal suffixes from names it does not know', () => {
    expect(shortOperatorName('Zenlayer Inc')).toBe('Zenlayer')
    expect(shortOperatorName('Hetzner Online GmbH')).toBe('Hetzner Online')
    expect(shortOperatorName('Example Networks Pty Ltd.')).toBe('Example Networks')
    expect(shortOperatorName('Scaleway S.A.S.')).toBe('Scaleway')
    expect(shortOperatorName('EXAMPLE-AS')).toBe('EXAMPLE')
  })

  it('keeps a name that is only a suffix', () => {
    expect(shortOperatorName('Limited')).toBe('Limited')
  })

  it('returns null without a name', () => {
    expect(shortOperatorName(null)).toBeNull()
    expect(shortOperatorName(undefined)).toBeNull()
    expect(shortOperatorName('  ')).toBeNull()
  })
})
