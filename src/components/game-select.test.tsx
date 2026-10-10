import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { GameSelect } from './game-select'

afterEach(cleanup)

const matches = (count: number) => `${count} matches`

const two = [
  { name: 'VALORANT', count: 12 },
  { name: 'League of Legends', count: 40 },
]

const many = [
  'Apex Legends',
  'Counter-Strike 2',
  'Dota 2',
  'Fortnite',
  'League of Legends',
  'Overwatch 2',
  'Rocket League',
  'Rainbow Six Siege',
  'VALORANT',
].map((name, i) => ({ name, count: i + 1 }))

describe('GameSelect', () => {
  it('names the control and shows the current game', () => {
    render(<GameSelect games={two} value="VALORANT" onValueChange={vi.fn()} countLabel={matches} />)

    const trigger = screen.getByRole('combobox', { name: 'Game' })
    expect(trigger).toHaveTextContent('Game:VALORANT')
  })

  it('lists the games by number of matches with their count', async () => {
    const onValueChange = vi.fn()
    render(
      <GameSelect games={two} value="VALORANT" onValueChange={onValueChange} countLabel={matches} />
    )

    await userEvent.click(screen.getByRole('combobox', { name: 'Game' }))
    const options = await screen.findAllByRole('option')
    expect(options.map(option => option.textContent)).toEqual([
      'League of Legends4040 matches',
      'VALORANT1212 matches',
    ])
    expect(within(options[0]).getByText('40')).toHaveClass('font-mono', 'tabular-nums')

    await userEvent.click(screen.getByRole('option', { name: /League of Legends/ }))
    expect(onValueChange).toHaveBeenCalledWith('League of Legends')
  })

  it('offers every game first where it applies and reports it as no filter', async () => {
    const onValueChange = vi.fn()
    render(
      <GameSelect
        allowAll
        games={two}
        value="VALORANT"
        onValueChange={onValueChange}
        countLabel={matches}
      />
    )

    await userEvent.click(screen.getByRole('combobox', { name: 'Game' }))
    const options = await screen.findAllByRole('option')
    expect(options[0]).toHaveTextContent('All games')
    expect(options[0]).toHaveTextContent('52')

    await userEvent.click(options[0])
    expect(onValueChange).toHaveBeenCalledWith(null)
  })

  it('reads All in the trigger when nothing is filtered', () => {
    render(
      <GameSelect allowAll games={two} value={null} onValueChange={vi.fn()} countLabel={matches} />
    )

    expect(screen.getByRole('combobox', { name: 'Game' })).toHaveTextContent('Game:All')
  })

  it('works from the keyboard', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(
      <GameSelect games={two} value="VALORANT" onValueChange={onValueChange} countLabel={matches} />
    )

    await user.tab()
    expect(screen.getByRole('combobox', { name: 'Game' })).toHaveFocus()
    await user.keyboard('{Enter}')
    await screen.findAllByRole('option')
    await user.keyboard('{ArrowUp}{Enter}')
    expect(onValueChange).toHaveBeenCalledWith('League of Legends')
  })

  it('adds a search field above eight games', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(
      <GameSelect
        games={many}
        value="VALORANT"
        onValueChange={onValueChange}
        countLabel={matches}
      />
    )

    await user.click(screen.getByRole('combobox', { name: 'Game' }))
    const search = await screen.findByRole('combobox', { name: 'Search games' })
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('VALORANT')

    await user.type(search, 'leg')
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual([
      'League of Legends55 matches',
      'Apex Legends11 matches',
    ])

    await user.keyboard('{ArrowDown}{Enter}')
    expect(onValueChange).toHaveBeenCalledWith('League of Legends')
  })

  it('says when no game matches the search', async () => {
    const user = userEvent.setup()
    render(
      <GameSelect games={many} value="VALORANT" onValueChange={vi.fn()} countLabel={matches} />
    )

    await user.click(screen.getByRole('combobox', { name: 'Game' }))
    await user.type(await screen.findByRole('combobox', { name: 'Search games' }), 'zelda')
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText('No matching game')).toBeInTheDocument()
  })
})
