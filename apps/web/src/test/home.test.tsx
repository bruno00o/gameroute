import type { RouteComponent } from '@tanstack/react-router'
import { fireEvent, screen } from '@testing-library/react'
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
    expect(screen.getByRole('link', { name: /Installez GameRoute/ })).toHaveAttribute(
      'href',
      '/telecharger'
    )
  })

  it('switches game and country', async () => {
    renderAtRoot(HomePage)

    fireEvent.click(await screen.findByRole('button', { name: 'Counter-Strike 2' }))
    expect(screen.getByRole('button', { name: 'Counter-Strike 2' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByText(/Ce jeu ne donne pas son ping/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Pays'), { target: { value: 'BE' } })
    expect(
      screen.getByRole('heading', { name: 'Parties sans incident, Counter-Strike 2, Belgique' })
    ).toBeInTheDocument()
  })

  it('filters the game list', async () => {
    renderAtRoot(HomePage)

    fireEvent.change(await screen.findByLabelText('Jeu'), { target: { value: 'league' } })
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual([
      'League of Legends',
    ])

    fireEvent.change(screen.getByLabelText('Jeu'), { target: { value: 'zzz' } })
    expect(screen.getByText('Aucun jeu de cette liste ne correspond.')).toBeInTheDocument()
  })
})
