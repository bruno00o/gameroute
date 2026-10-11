import { sampleReport } from '@gameroute/api/fixtures'
import type { ReportPayload } from '@gameroute/shared'
import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ReportMissing, ReportView } from '@/components/report/ReportView'
import { renderAtRoot } from './render'

function renderReport(payload: ReportPayload = sampleReport()) {
  const report = {
    id: '4fK9qTz2LmV8xR1sNc7HbQ',
    payload,
    createdAt: '2026-10-11T21:40:00.000Z',
    expiresAt: '2027-01-09T21:40:00.000Z',
  }
  return renderAtRoot(() => <ReportView report={report} />)
}

const text = (element: HTMLElement) => element.textContent?.replaceAll(' ', ' ')

describe('report view', () => {
  it('states the verdict, the facts and the period in the player time', async () => {
    renderReport()

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Le problème se situe dans le transit, pas chez vous ni chez votre FAI',
      })
    ).toBeInTheDocument()
    expect(screen.getByText(/Rapport partagé sur un forum/)).toBeInTheDocument()
    expect(
      screen.getByText('11 octobre 2026, de 20 h à 21 h (heure du joueur, UTC+2)')
    ).toBeInTheDocument()
    expect(screen.getAllByText('AS15557')[0]).toBeInTheDocument()
    expect(screen.getByText(/Ce lien expire le 9 janvier 2027/)).toBeInTheDocument()
    expect(screen.getByText('Les heures sont arrondies à l’heure.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Comment GameRoute mesure' })).toHaveAttribute(
      'href',
      '/methode'
    )
  })

  it('marks a ping measured up to a hop as a minimum', async () => {
    renderReport()

    const matches = await screen.findByRole('table', { name: 'Parties' })
    const [, first, second] = within(matches).getAllByRole('row')
    expect(text(first)).toContain('≥ 41 ms')
    expect(text(first)).toContain('mesuré par GameRoute jusqu’au saut 9')
    expect(text(first)).toContain('ping au-dessus de l’habituel')
    expect(text(second)).toContain('24 ms')
    expect(text(second)).toContain('mesuré par le jeu')
    expect(text(second)).not.toContain('≥')
    expect(
      screen.getByText(
        'Partie 1 : ping médian de ≥ 41 ms (mesuré par GameRoute jusqu’au saut 9) pour 22 ms d’habitude.',
        {
          normalizer: value => value.replaceAll(' ', ' '),
        }
      )
    ).toBeInTheDocument()
  })

  it('shows the silent destination and the route by operator', async () => {
    renderReport()

    const strip = await screen.findByRole('list', { name: 'Route par opérateur' })
    const items = within(strip).getAllByRole('listitem')
    expect(items.map(item => item.dataset.zone ?? item.dataset.destination)).toEqual([
      'home',
      'isp',
      'transit',
      'silent',
    ])
    expect(items[2]).toHaveAttribute('data-status', 'degraded')
    expect(text(items[2])).toContain('+32 ms')
    expect(text(items[3])).toContain('Riot Games')
    expect(text(items[3])).toContain('Ne répond pas aux pings')
    expect(screen.getByText(/jusqu’au saut 9, le dernier routeur qui répond/)).toBeInTheDocument()
  })

  it('never shows an address on home hops', async () => {
    renderReport()

    const hops = await screen.findByRole('table', { name: 'Sauts de la partie 1' })
    const [, home, silent, isp] = within(hops).getAllByRole('row')
    expect(text(home)).toContain('réseau local, non partagée')
    expect(text(home)).not.toMatch(/\d+\.\d+\.\d+\.\d+/)
    expect(text(silent)).toContain('Ne répond pas aux pings')
    expect(text(isp)).toContain('194.6.150.68')
  })

  it('speaks about the player when the report is for the ISP', async () => {
    const payload = sampleReport()
    payload.recipient = 'isp'
    renderReport(payload)

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Le problème se situe dans le transit, pas chez le joueur ni chez son FAI',
      })
    ).toBeInTheDocument()
    expect(screen.getByText(/Rapport préparé pour le support de SFR/)).toBeInTheDocument()
  })

  it('explains a missing report', async () => {
    renderAtRoot(() => <ReportMissing id="unknown" />)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Rapport introuvable ou expiré' })
    ).toBeInTheDocument()
  })
})
