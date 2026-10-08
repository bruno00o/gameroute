import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Segmented } from './segmented'

afterEach(cleanup)

const options = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
] as const

describe('Segmented', () => {
  it('names the group and presses the first option by default', () => {
    render(<Segmented label="Theme" options={options} />)

    expect(screen.getByRole('group', { name: 'Theme' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('moves the selection when uncontrolled', async () => {
    const onValueChange = vi.fn()
    render(
      <Segmented
        label="Theme"
        options={options}
        defaultValue="dark"
        onValueChange={onValueChange}
      />
    )

    await userEvent.click(screen.getByRole('button', { name: 'System' }))

    expect(onValueChange).toHaveBeenCalledWith('system')
    expect(screen.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('keeps the controlled value until the parent changes it', async () => {
    const onValueChange = vi.fn()
    const { rerender } = render(
      <Segmented label="Theme" options={options} value="light" onValueChange={onValueChange} />
    )

    await userEvent.click(screen.getByRole('button', { name: 'Dark' }))

    expect(onValueChange).toHaveBeenCalledWith('dark')
    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true')

    rerender(
      <Segmented label="Theme" options={options} value="dark" onValueChange={onValueChange} />
    )

    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('never ends up with nothing selected', async () => {
    const onValueChange = vi.fn()
    render(<Segmented label="Theme" options={options} onValueChange={onValueChange} />)

    await userEvent.click(screen.getByRole('button', { name: 'Light' }))

    expect(onValueChange).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('ignores clicks when disabled', async () => {
    const onValueChange = vi.fn()
    render(<Segmented label="Theme" options={options} onValueChange={onValueChange} disabled />)

    await userEvent.click(screen.getByRole('button', { name: 'Dark' }))

    expect(onValueChange).not.toHaveBeenCalled()
  })
})
