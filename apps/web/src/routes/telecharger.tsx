import { createFileRoute } from '@tanstack/react-router'
import { pageHead } from '@/lib/head'
import { LATEST_RELEASE_URL, RELEASES_URL } from '@/lib/links'
import { m } from '@/paraglide/messages'

export const Route = createFileRoute('/telecharger')({
  head: () =>
    pageHead({ title: m.meta_download_title(), description: m.meta_download_description() }),
  component: DownloadPage,
})

const GRID = 'gw-wrap grid gap-x-[72px]'

function DownloadPage() {
  return (
    <>
      <section
        className={`${GRID} grid-cols-[repeat(auto-fit,minmax(min(460px,100%),1fr))] gap-y-12 pt-20 pb-[88px]`}
      >
        <div className="flex min-w-0 flex-col items-start gap-6">
          <h1 className="gw-display">{m.dl_title()}</h1>
          <p className="gw-lead">{m.dl_lead()}</p>
          <a className="gr-btn gr-btn--primary gr-btn--lg" href={LATEST_RELEASE_URL}>
            {m.dl_cta()}
          </a>
          <p className="gw-small max-w-[52ch]">{m.dl_cta_note()}</p>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm leading-5">
            <a href={LATEST_RELEASE_URL}>{m.dl_release_notes()}</a>
            <a href={RELEASES_URL}>{m.dl_all_versions()}</a>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <h2 className="gw-h3">{m.dl_does_title()}</h2>
          <ol className="gw-list gap-3.5">
            <li>{m.dl_does_app()}</li>
            <li>{m.dl_does_service()}</li>
            <li>{m.dl_does_nothing_sent()}</li>
          </ol>
          <p className="gw-small">{m.dl_platforms()}</p>
          <h2 className="gw-h3 mt-4">{m.dl_not_title()}</h2>
          <ul className="gw-list">
            <li>{m.dl_not_account()}</li>
            <li>{m.dl_not_default()}</li>
            <li>{m.dl_not_location()}</li>
            <li>{m.dl_not_free_text()}</li>
          </ul>
        </div>
      </section>

      <section className="border-y bg-surface">
        <div
          className={`${GRID} grid-cols-[repeat(auto-fit,minmax(min(420px,100%),1fr))] gap-y-8 py-20`}
        >
          <div className="flex min-w-0 flex-col gap-3">
            <h2 className="gw-h2">{m.dl_smartscreen_title()}</h2>
            <p className="gw-text">{m.dl_smartscreen_text()}</p>
            <p className="gw-text">{m.dl_smartscreen_meaning()}</p>
          </div>
          <div className="flex min-w-0 flex-col gap-5">
            <div className="gr-notice">
              <p className="gr-notice__title">{m.dl_smartscreen_notice_title()}</p>
              <p className="gr-notice__body">{m.dl_smartscreen_notice_body()}</p>
            </div>
            <ol className="gw-list gap-3">
              <li>{m.dl_smartscreen_step_more()}</li>
              <li>{m.dl_smartscreen_step_check()}</li>
              <li>{m.dl_smartscreen_step_run()}</li>
            </ol>
          </div>
        </div>
      </section>

      <section
        className={`${GRID} grid-cols-[repeat(auto-fit,minmax(min(420px,100%),1fr))] gap-y-10 pt-20 pb-24`}
      >
        <div className="flex min-w-0 flex-col gap-4">
          <h2 className="gw-h3">{m.dl_req_title()}</h2>
          <dl className="m-0 grid grid-cols-[minmax(120px,max-content)_minmax(0,1fr)] gap-x-6 gap-y-3 text-[15px] leading-[22px]">
            <dt className="gw-label pt-[3px]">{m.dl_req_system()}</dt>
            <dd className="m-0">{m.dl_req_system_value()}</dd>
            <dt className="gw-label pt-[3px]">{m.dl_req_rights()}</dt>
            <dd className="m-0">{m.dl_req_rights_value()}</dd>
          </dl>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <h2 className="gw-h3">{m.dl_uninstall_title()}</h2>
          <p className="gw-text">{m.dl_uninstall_how()}</p>
          <p className="gw-text">{m.dl_uninstall_data()}</p>
        </div>
      </section>
    </>
  )
}
