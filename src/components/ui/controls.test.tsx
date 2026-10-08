import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RiPlayFill } from '@remixicon/react'

import { Button } from './button'
import { SwitchField } from './switch'
import { TextField } from './text-field'

afterEach(cleanup)

describe('Button', () => {
  it('is secondary and medium by default', () => {
    render(<Button>Export</Button>)

    const button = screen.getByRole('button', { name: 'Export' })
    expect(button).toHaveClass('border-line-strong', 'h-8')
    expect(button).not.toHaveAttribute('aria-busy')
  })

  it('blocks clicks and swaps its icon for a spinner while loading', async () => {
    const onClick = vi.fn()
    render(
      <Button loading onClick={onClick}>
        <RiPlayFill data-testid="icon" />
        Start monitoring
      </Button>
    )

    const button = screen.getByRole('button', { name: 'Start monitoring' })
    await userEvent.click(button)

    expect(onClick).not.toHaveBeenCalled()
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button.querySelector('[data-slot=spinner]')).not.toBeNull()
    expect(button).toHaveClass('[&>svg:not([data-slot=spinner])]:hidden', 'disabled:opacity-100')
  })
})

describe('SwitchField', () => {
  it('labels and describes the switch', () => {
    render(<SwitchField label="Launch at startup" description="Starts minimised in the tray." />)

    const control = screen.getByRole('switch', { name: 'Launch at startup' })
    expect(control).toHaveAccessibleDescription('Starts minimised in the tray.')
  })

  it('toggles from the switch and from its label', async () => {
    const onCheckedChange = vi.fn()
    render(<SwitchField label="Detailed view" onCheckedChange={onCheckedChange} />)

    await userEvent.click(screen.getByRole('switch', { name: 'Detailed view' }))
    await userEvent.click(screen.getByText('Detailed view'))

    expect(onCheckedChange.mock.calls.map(call => call[0])).toEqual([true, false])
  })

  it('does not toggle when disabled', async () => {
    const onCheckedChange = vi.fn()
    render(<SwitchField label="Detailed view" disabled onCheckedChange={onCheckedChange} />)

    await userEvent.click(screen.getByRole('switch', { name: 'Detailed view' }))

    expect(onCheckedChange).not.toHaveBeenCalled()
  })
})

describe('TextField', () => {
  it('links the label and the hint to the input', () => {
    render(<TextField label="Server address" hint="IPv4 or IPv6." />)

    const input = screen.getByRole('textbox', { name: 'Server address' })
    expect(input).toHaveAccessibleDescription('IPv4 or IPv6.')
    expect(input).not.toHaveAttribute('aria-invalid')
  })

  it('shows the error instead of the hint and marks the input invalid', () => {
    render(
      <TextField
        label="Server address"
        hint="IPv4 or IPv6."
        error="Incomplete address. Example: 203.0.113.42"
      />
    )

    const input = screen.getByRole('textbox', { name: 'Server address' })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('Incomplete address. Example: 203.0.113.42')
    expect(screen.queryByText('IPv4 or IPv6.')).toBeNull()
  })

  it('renders prefix and suffix around the input', () => {
    render(<TextField aria-label="Threshold" prefix="≥" suffix="ms" mono defaultValue="80" />)

    const input = screen.getByRole('textbox', { name: 'Threshold' })
    expect(input).toHaveClass('font-mono')
    expect(screen.getByText('≥')).toBeInTheDocument()
    expect(screen.getByText('ms')).toBeInTheDocument()
  })
})
