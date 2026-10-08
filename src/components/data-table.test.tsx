import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { Severity } from '@/types/backend'
import { StatusPill } from '@/components/status/status-pill'
import { DataTable, type DataTableColumn } from './data-table'

afterEach(cleanup)

type Match = {
  id: number
  game: string
  rtt: number | null
  status: Severity
}

const rows: Match[] = [
  { id: 1, game: 'Valorant', rtt: 18, status: 'degraded' },
  { id: 2, game: 'Counter-Strike 2', rtt: 31, status: 'watch' },
  { id: 3, game: 'Fortnite', rtt: null, status: 'unmeasured' },
  { id: 4, game: 'League of Legends', rtt: 24, status: 'ok' },
]

const statusRank: Record<Severity, number> = {
  ok: 0,
  watch: 1,
  degraded: 2,
  critical: 3,
  unmeasured: -1,
}

const columns: DataTableColumn<Match>[] = [
  { key: 'game', label: 'Game' },
  { key: 'rtt', label: 'Ping', align: 'end', mono: true },
  {
    key: 'status',
    label: 'Status',
    sortValue: match => statusRank[match.status],
    render: match => <StatusPill status={match.status} />,
  },
]

const bodyRows = () => within(screen.getAllByRole('rowgroup')[1]).getAllByRole('row')
const firstCells = () => bodyRows().map(row => within(row).getAllByRole('cell')[0].textContent)

describe('DataTable', () => {
  it('renders one row per item and a dash for a missing value', () => {
    render(<DataTable columns={columns} rows={rows} />)

    expect(bodyRows()).toHaveLength(4)
    const fortnite = screen.getByRole('row', { name: /Fortnite/ })
    expect(within(fortnite).getAllByRole('cell')[1]).toHaveTextContent('—')
  })

  it('aligns numbers to the end in tabular mono', () => {
    render(<DataTable columns={columns} rows={rows} />)

    const cell = within(screen.getByRole('row', { name: /Valorant/ })).getAllByRole('cell')[1]
    expect(cell).toHaveClass('text-right', 'font-mono', 'tabular-nums')
    expect(screen.getByRole('columnheader', { name: /Ping/ })).toHaveClass('text-right')
  })

  it('sorts ascending then descending and keeps missing values last', async () => {
    render(<DataTable columns={columns} rows={rows} />)

    await userEvent.click(screen.getByRole('button', { name: 'Ping' }))
    expect(screen.getByRole('columnheader', { name: /Ping/ })).toHaveAttribute(
      'aria-sort',
      'ascending'
    )
    expect(firstCells()).toEqual(['Valorant', 'League of Legends', 'Counter-Strike 2', 'Fortnite'])

    await userEvent.click(screen.getByRole('button', { name: 'Ping' }))
    expect(screen.getByRole('columnheader', { name: /Ping/ })).toHaveAttribute(
      'aria-sort',
      'descending'
    )
    expect(firstCells()).toEqual(['Counter-Strike 2', 'League of Legends', 'Valorant', 'Fortnite'])
  })

  it('sorts the status column by severity and shows each status with its glyph', () => {
    render(<DataTable columns={columns} rows={rows} defaultSort={{ key: 'status', dir: 'desc' }} />)

    expect(firstCells()).toEqual(['Valorant', 'Counter-Strike 2', 'League of Legends', 'Fortnite'])
    const pill = within(screen.getByRole('row', { name: /Valorant/ })).getByText('Degraded')
    expect(pill.parentElement!.querySelector('[data-slot=severity-glyph]')).toBeInTheDocument()
  })

  it('does not offer sorting on a column marked unsortable', () => {
    render(
      <DataTable
        columns={[{ key: 'game', label: 'Game', sortable: false }, columns[1]]}
        rows={rows}
      />
    )

    expect(screen.queryByRole('button', { name: 'Game' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ping' })).toBeInTheDocument()
  })

  it('opens a row with a click, Enter or Space', async () => {
    const onRowClick = vi.fn()
    render(<DataTable columns={columns} rows={rows} onRowClick={onRowClick} />)

    const valorant = screen.getByRole('row', { name: /Valorant/ })
    await userEvent.click(within(valorant).getByText('Valorant'))
    expect(onRowClick).toHaveBeenLastCalledWith(rows[0])

    const fortnite = screen.getByRole('row', { name: /Fortnite/ })
    fortnite.focus()
    await userEvent.keyboard('{Enter}')
    expect(onRowClick).toHaveBeenLastCalledWith(rows[2])

    const league = screen.getByRole('row', { name: /League/ })
    league.focus()
    await userEvent.keyboard(' ')
    expect(onRowClick).toHaveBeenLastCalledWith(rows[3])
    expect(onRowClick).toHaveBeenCalledTimes(3)
  })

  it('makes rows focusable only when they can be opened', () => {
    const { rerender } = render(<DataTable columns={columns} rows={rows} />)
    expect(screen.getByRole('row', { name: /Valorant/ })).not.toHaveAttribute('tabindex')

    rerender(<DataTable columns={columns} rows={rows} onRowClick={() => {}} />)
    expect(screen.getByRole('row', { name: /Valorant/ })).toHaveAttribute('tabindex', '0')
  })

  it('ignores clicks and keys coming from a control inside the row', async () => {
    const onRowClick = vi.fn()
    const onDelete = vi.fn()
    render(
      <DataTable
        columns={[
          ...columns,
          {
            key: 'actions',
            label: 'Actions',
            sortable: false,
            render: match => (
              <button type="button" onClick={() => onDelete(match.id)}>
                Delete {match.game}
              </button>
            ),
          },
        ]}
        rows={rows}
        onRowClick={onRowClick}
      />
    )

    await userEvent.click(screen.getByRole('button', { name: 'Delete Valorant' }))
    screen.getByRole('button', { name: 'Delete Fortnite' }).focus()
    await userEvent.keyboard('{Enter}')

    expect(onDelete).toHaveBeenCalledTimes(2)
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('marks the selected row with a neutral background', () => {
    render(<DataTable columns={columns} rows={rows} onRowClick={() => {}} selectedKey={2} />)

    const selected = screen.getByRole('row', { name: /Counter-Strike/ })
    expect(selected).toHaveAttribute('data-state', 'selected')
    expect(selected).toHaveAttribute('aria-current', 'true')
    expect(selected.className).toMatch(/data-\[state=selected\]:bg-muted/)
    expect(selected.className).not.toMatch(/bg-(ok|watch|degraded|critical|signal)/)
    expect(screen.getByRole('row', { name: /Valorant/ })).not.toHaveAttribute('data-state')
  })

  it('pages through rows on the client', async () => {
    render(<DataTable columns={columns} rows={rows} pageSize={3} />)

    expect(bodyRows()).toHaveLength(3)
    expect(screen.getByText('1–3 of 4')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Previous/ })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: /Next/ }))

    expect(firstCells()).toEqual(['League of Legends'])
    expect(screen.getByText('4–4 of 4')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled()
  })

  it('hands page changes to the parent and disables sorting when paged on the server', async () => {
    const onPageChange = vi.fn()
    render(
      <DataTable
        columns={columns}
        rows={rows.slice(0, 2)}
        pagination={{ pageIndex: 1, pageSize: 2, rowCount: 7, onPageChange }}
      />
    )

    expect(screen.getByText('3–4 of 7')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ping' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Next/ }))
    expect(onPageChange).toHaveBeenLastCalledWith(2)

    await userEvent.click(screen.getByRole('button', { name: /Previous/ }))
    expect(onPageChange).toHaveBeenLastCalledWith(0)
  })

  it('hides the pager when everything fits on one page', () => {
    render(<DataTable columns={columns} rows={rows} pageSize={10} />)

    expect(screen.queryByRole('button', { name: /Next/ })).not.toBeInTheDocument()
  })

  it('shows placeholder rows while loading', () => {
    render(<DataTable columns={columns} rows={[]} loading empty={<p>Nothing yet</p>} />)

    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true')
    expect(bodyRows()).toHaveLength(5)
    expect(screen.queryByText('Nothing yet')).not.toBeInTheDocument()
  })

  it('shows the empty state instead of an empty table', () => {
    render(<DataTable columns={columns} rows={[]} empty={<p>No sessions recorded.</p>} />)

    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByText('No sessions recorded.')).toBeInTheDocument()
  })

  it('labels the table with its caption', () => {
    render(<DataTable columns={columns} rows={rows} caption="Matches" />)

    expect(screen.getByRole('table', { name: 'Matches' })).toBeInTheDocument()
  })
})
