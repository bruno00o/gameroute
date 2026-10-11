import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EMPTY_RANKING, type Ranking } from '@/data/barometer'
import { renderAtRoot } from '@/test/render'
import { IspRanking } from './IspRanking'

describe('IspRanking', () => {
  it('shows the collecting state when no ISP has data yet', async () => {
    renderAtRoot(() => <IspRanking ranking={EMPTY_RANKING} gameName="VALORANT" />)

    expect(
      await screen.findByText('Collecte en cours pour VALORANT dans ce pays.')
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Aucun FAI n’a encore 30 joueurs et 200 parties de VALORANT/)
    ).toBeInTheDocument()
    expect(
      screen.getByText('Joueurs mesurés pour ce choix : 0 sur 30 nécessaires par FAI')
    ).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('lists ranked ISPs before those still collecting', async () => {
    const ranking: Ranking = {
      players: 760,
      matches: 6350,
      ranked: [
        {
          rank: 1,
          tied: false,
          name: 'Fibre Exemple',
          asn: 64496,
          players: 520,
          matches: 4390,
          cleanShare: 94.2,
          ciHalfWidth: 1.6,
        },
        {
          rank: 1,
          tied: true,
          name: 'Box Exemple',
          asn: 64507,
          players: 240,
          matches: 1960,
          cleanShare: 92.8,
          ciHalfWidth: 3.4,
        },
      ],
      collecting: [{ name: 'Mobile Exemple', players: 22 }],
    }
    renderAtRoot(() => <IspRanking ranking={ranking} gameName="VALORANT" />)

    const items = within(await screen.findByRole('list')).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent('Fibre Exemple')
    expect(items[0]).toHaveTextContent('94,2 %')
    expect(items[0]).toHaveTextContent('fiabilité moyenne')
    expect(items[1]).toHaveTextContent('1 ex æquo')
    expect(items[1]).toHaveTextContent('fiabilité faible')
    expect(items[2]).toHaveTextContent('non classé')
    expect(items[2]).toHaveTextContent('22 joueurs sur 30 nécessaires')
  })
})
