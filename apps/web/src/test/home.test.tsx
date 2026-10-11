import type { RouteComponent } from '@tanstack/react-router'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Route } from '@/routes/index'
import { renderAtRoot } from './render'

const HomePage = Route.options.component as RouteComponent

describe('home route', () => {
  it('renders the barometer in the collecting state', async () => {
    renderAtRoot(HomePage)

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Quel FAI tient le mieux en partie, près de chez vous ?',
      })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Parties sans incident, VALORANT, France' })
    ).toBeInTheDocument()
    expect(screen.getByText('Collecte en cours pour VALORANT dans ce pays.')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
    expect(screen.getByRole('button', { name: 'Ping mesuré par le jeu' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Installez GameRoute/ })).toHaveAttribute(
      'href',
      '/download'
    )
    expect(screen.getByRole('link', { name: 'Télécharger pour Windows' })).toHaveAttribute(
      'href',
      '/download'
    )
  })

  it('switches game and country', async () => {
    renderAtRoot(HomePage)

    const games = within(await screen.findByRole('group', { name: 'Jeux' }))
    fireEvent.click(games.getByRole('button', { name: 'Counter-Strike 2' }))
    expect(games.getByRole('button', { name: 'Counter-Strike 2' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(games.getByRole('button', { name: 'VALORANT' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText(/Ce jeu ne donne pas son ping/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Latence mesurée par GameRoute' })
    ).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox', { name: 'Pays' }))
    await user.click(await screen.findByRole('option', { name: 'Belgique' }))
    expect(
      await screen.findByRole('heading', {
        name: 'Parties sans incident, Counter-Strike 2, Belgique',
      })
    ).toBeInTheDocument()
  })

  it('filters the game list', async () => {
    renderAtRoot(HomePage)

    fireEvent.change(await screen.findByRole('searchbox', { name: 'Jeu' }), {
      target: { value: 'league' },
    })
    const games = within(screen.getByRole('group', { name: 'Jeux' }))
    expect(games.getAllByRole('button').map(button => button.textContent)).toEqual([
      'League of Legends',
    ])

    fireEvent.change(screen.getByRole('searchbox', { name: 'Jeu' }), {
      target: { value: 'zzz' },
    })
    expect(screen.getByText('Aucun jeu de cette liste ne correspond.')).toBeInTheDocument()
  })
})
