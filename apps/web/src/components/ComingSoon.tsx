import { m } from '@/paraglide/messages'

export function ComingSoon({ title }: { title: string }) {
  return (
    <section className="gw-wrap flex flex-col gap-5 pt-20 pb-24">
      <h1 className="gw-display">{title}</h1>
      <p className="gw-lead">{m.coming_soon()}</p>
    </section>
  )
}
