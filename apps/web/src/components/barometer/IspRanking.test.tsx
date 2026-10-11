import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { EMPTY_RANKING, type Ranking } from '@/data/barometer'
import { renderAtRoot } from '@/test/render'
import { IspRanking } from './IspRanking'

function renderRanking(ranking: Ranking) {
  return renderAtRoot(() => (
    <TooltipProvider>
      <IspRanking ranking={ranking} gameName="VALORANT" />
    </TooltipProvider>
  ))
}

describe('IspRanking', () => {
  it('shows the collecting state when no ISP has data yet', async () => {
    renderRanking(EMPTY_RANKING)

    expect(
      await screen.findByText('Collecte en cours pour VALORANT dans ce pays.')
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Aucun FAI n’a encore 30 joueurs et 200 parties de VALORANT/)
    ).toBeInTheDocument()
    const progress = screen.getByRole('progressbar')
    expect(progress).toHaveAttribute('aria-valuenow', '0')
    expect(progress).toHaveAttribute('aria-valuemax', '30')
    expect(
      screen.getByText('Joueurs mesurés pour ce choix : 0 sur 30 nécessaires par FAI')
    ).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
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
    renderRanking(ranking)

    const table = await screen.findByRole('table')
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map(cell => cell.textContent)
    ).toEqual(['Rang', 'FAI', 'Parties sans incident', 'Échantillon'])
    expect(
      within(table).getByRole('button', { name: 'À propos de l’échantillon' })
    ).toBeInTheDocument()

    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Fibre Exemple')
    expect(rows[0]).toHaveTextContent('AS64496')
    expect(rows[0]).toHaveTextContent('94,2 %')
    expect(rows[0]).toHaveTextContent('fiabilité moyenne')
    expect(rows[1]).toHaveTextContent('1 ex æquo')
    expect(rows[1]).toHaveTextContent('fiabilité faible')
    expect(rows[2]).toHaveTextContent('non classé')
    expect(rows[2]).toHaveTextContent('22 joueurs sur 30 nécessaires')
    expect(within(rows[2]).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '22')
  })
})
