import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Route } from './help'

const NB = ' '

const messages = import.meta.glob<Record<string, string>>('../../messages/*.json', {
  eager: true,
  import: 'default',
})

function renderHelp() {
  const HelpPage = Route.options.component!
  return render(<HelpPage />)
}

const section = (name: string) => screen.getByRole('region', { name })
const question = (name: RegExp) => screen.getByRole('button', { name })
const terms = () => screen.queryAllByRole('term').map(term => term.textContent)

afterEach(cleanup)

describe('Help', () => {
  it('explains how it works with one sentence and a real route strip', () => {
    const { container } = renderHelp()

    const how = section('How it works')
    expect(within(how).getByText(/spots the game server, traces the route/)).toBeInTheDocument()
    const strip = how.querySelector('[data-slot=route-strip]')!
    expect(strip).toBeInTheDocument()
    expect(within(strip as HTMLElement).getByText('RETN')).toBeInTheDocument()
    expect(strip.querySelector('[data-destination=silent]')).toBeInTheDocument()
    expect(strip.querySelector('[data-slot=route-total]')?.textContent).toContain(`≥${NB}17${NB}ms`)

    expect(container.querySelector('[data-slot=card]')).not.toBeInTheDocument()
    expect(container.querySelectorAll('ol')).toHaveLength(1)
  })

  it('lists the glossary as terms and definitions that match the app', () => {
    renderHelp()

    const glossary = section('Glossary')
    expect(glossary.querySelector('dl')).toBeInTheDocument()
    expect(terms()).toEqual(
      expect.arrayContaining([
        'Ping',
        'Loss',
        'Jitter',
        `≥${NB}17${NB}ms`,
        "Doesn't answer pings",
        'Ignores some pings, which is normal',
        'Problem hop',
        'Your ISP',
        'Transit',
        'Not measurable',
      ])
    )

    const definition = screen.getByText('Problem hop').nextElementSibling!
    expect(definition).toHaveTextContent('10% or more')
    expect(definition.textContent).toContain(`50${NB}ms`)
    expect(definition).toHaveTextContent('carries on to the destination')

    const usual = screen.getByText('Usual ping').nextElementSibling!
    expect(usual).toHaveTextContent('median of the last 20 measurements taken before the match')
    expect(usual).toHaveTextContent('at least 5')
    expect(usual).toHaveTextContent('A “≥” value is never mixed with a real round trip.')

    const quality = screen.getByText('Quality (Good, Watch, Degraded, Critical)')
      .nextElementSibling!
    expect(quality.textContent).toContain(`“Watch” at +20${NB}ms above it`)
    expect(quality.textContent).toContain(`“Critical” at +100${NB}ms`)
    expect(quality).toHaveTextContent('Without one, fixed thresholds apply to the ping.')
    expect(quality).toHaveTextContent('under “Why this status”')
  })

  it('opens the first question and lets the others unfold', async () => {
    const user = userEvent.setup()
    renderHelp()

    const first = question(/Why does the ping start with “≥”\?/)
    expect(first).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/Riot Direct, Riot's network, drops every packet/)).toBeVisible()

    const antiCheat = question(/Does GameRoute touch the game or its anti-cheat\?/)
    expect(antiCheat).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/doesn't read its memory/)).not.toBeInTheDocument()

    await user.click(antiCheat)
    expect(antiCheat).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/doesn't read its memory/)).toHaveTextContent(
      "isn't approved by Riot or any other publisher"
    )
  })

  it('names the controls the answers point to', async () => {
    const user = userEvent.setup()
    renderHelp()

    await user.click(question(/What should I send my ISP\?/))
    expect(screen.getByText(/choose “Copy diagnostic”/)).toBeInTheDocument()

    await user.click(question(/My game isn't detected/))
    expect(screen.getByText(/use “Select process” next to “Start”/)).toBeInTheDocument()

    await user.click(question(/What data leaves this PC\?/))
    const data = screen.getByText(
      /GitHub for updates and to Steam for game images, asks your DNS server for router names/
    )
    expect(data).toHaveTextContent('to your router')
    expect(data).toHaveTextContent('to a public measurement point')
    expect(data).toHaveTextContent('see your public IP address')
    expect(data).toHaveTextContent('There is no telemetry.')
    expect(data).toHaveTextContent("planned for version 1.0; it doesn't exist yet")
  })

  it('filters the glossary and questions as you type and opens matching answers', async () => {
    const user = userEvent.setup()
    renderHelp()

    await user.type(screen.getByRole('textbox', { name: 'Search help' }), 'vanguard')

    expect(screen.queryByRole('region', { name: 'How it works' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Glossary' })).not.toBeInTheDocument()
    const faq = within(section('Common questions')).getAllByRole('button')
    expect(faq).toHaveLength(1)
    expect(faq[0]).toHaveAccessibleName('Does GameRoute touch the game or its anti-cheat?')
    expect(faq[0]).toHaveAttribute('aria-expanded', 'true')

    await user.clear(screen.getByRole('textbox', { name: 'Search help' }))
    await user.type(screen.getByRole('textbox', { name: 'Search help' }), 'JITTER')
    expect(terms()).toEqual(['Jitter'])
  })

  it('says when nothing matches and clears the search', async () => {
    const user = userEvent.setup()
    renderHelp()

    const search = screen.getByRole('textbox', { name: 'Search help' })
    await user.type(search, 'bufferbloat')

    expect(screen.getByText('Nothing in help for “bufferbloat”')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear search' }))

    expect(search).toHaveValue('')
    expect(section('How it works')).toBeInTheDocument()
    expect(terms().length).toBeGreaterThan(10)
  })

  it('keeps the help keys translated in every language, without ip-api', () => {
    const helpKeys = (locale: string) =>
      Object.keys(messages[`../../messages/${locale}.json`])
        .filter(key => key.startsWith('help_'))
        .sort()

    expect(helpKeys('fr')).toEqual(helpKeys('en'))
    expect(helpKeys('es')).toEqual(helpKeys('en'))
    for (const [file, strings] of Object.entries(messages)) {
      expect(JSON.stringify(strings), file).not.toMatch(/ip-api/i)
    }
  })
})
