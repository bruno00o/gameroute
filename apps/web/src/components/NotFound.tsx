import { Link } from '@tanstack/react-router'
import { m } from '@/paraglide/messages'

export function NotFound() {
  return (
    <section className="gw-wrap flex flex-col items-start gap-5 pt-20 pb-24">
      <h1 className="gw-display">{m.not_found_title()}</h1>
      <p className="gw-lead">{m.not_found_text()}</p>
      <Link to="/" className="text-[15px] leading-6">
        {m.not_found_home()}
      </Link>
    </section>
  )
}
