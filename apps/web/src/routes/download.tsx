import { RiDownloadLine, RiShieldLine } from '@remixicon/react'
import { createFileRoute } from '@tanstack/react-router'
import { Container } from '@/components/Container'
import {
  Display,
  Heading,
  Lead,
  List,
  OrderedList,
  Small,
  Text,
  Title,
} from '@/components/Typography'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AnchorButton } from '@/components/LinkButton'
import { pageHead } from '@/lib/head'
import { LATEST_RELEASE_URL, RELEASES_URL } from '@/lib/links'
import { m } from '@/paraglide/messages'

export const Route = createFileRoute('/download')({
  head: () =>
    pageHead({
      title: m.meta_download_title(),
      description: m.meta_download_description(),
      path: '/download',
    }),
  component: DownloadPage,
})

const TWO_COLUMNS = 'grid grid-cols-[repeat(auto-fit,minmax(min(420px,100%),1fr))] gap-x-[72px]'

function DownloadPage() {
  return (
    <>
      <Container className={`${TWO_COLUMNS} gap-y-12 pt-20 pb-[88px]`}>
        <div className="flex min-w-0 flex-col items-start gap-6">
          <Display>{m.dl_title()}</Display>
          <Lead>{m.dl_lead()}</Lead>
          <AnchorButton href={LATEST_RELEASE_URL} size="lg">
            <RiDownloadLine aria-hidden="true" />
            {m.dl_cta()}
          </AnchorButton>
          <Small className="max-w-[52ch]">{m.dl_cta_note()}</Small>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-[14px] leading-5">
            <a href={LATEST_RELEASE_URL}>{m.dl_release_notes()}</a>
            <a href={RELEASES_URL}>{m.dl_all_versions()}</a>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Heading>{m.dl_does_title()}</Heading>
          <OrderedList className="gap-3.5">
            <li>{m.dl_does_app()}</li>
            <li>{m.dl_does_service()}</li>
            <li>{m.dl_does_nothing_sent()}</li>
          </OrderedList>
          <Small>{m.dl_platforms()}</Small>
          <Heading className="mt-4">{m.dl_not_title()}</Heading>
          <List>
            <li>{m.dl_not_account()}</li>
            <li>{m.dl_not_default()}</li>
            <li>{m.dl_not_location()}</li>
            <li>{m.dl_not_free_text()}</li>
          </List>
        </div>
      </Container>

      <section className="border-y bg-card">
        <Container className={`${TWO_COLUMNS} gap-y-8 py-20`}>
          <div className="flex min-w-0 flex-col gap-3">
            <Title>{m.dl_smartscreen_title()}</Title>
            <Text>{m.dl_smartscreen_text()}</Text>
            <Text>{m.dl_smartscreen_meaning()}</Text>
          </div>
          <div className="flex min-w-0 flex-col gap-5">
            <Alert role="note" className="bg-muted px-4 py-3 text-ui">
              <RiShieldLine aria-hidden="true" />
              <AlertTitle className="font-semibold">{m.dl_smartscreen_notice_title()}</AlertTitle>
              <AlertDescription className="text-ui">
                {m.dl_smartscreen_notice_body()}
              </AlertDescription>
            </Alert>
            <OrderedList className="gap-3">
              <li>{m.dl_smartscreen_step_more()}</li>
              <li>{m.dl_smartscreen_step_check()}</li>
              <li>{m.dl_smartscreen_step_run()}</li>
            </OrderedList>
          </div>
        </Container>
      </section>

      <Container className={`${TWO_COLUMNS} gap-y-10 pt-20 pb-24`}>
        <div className="flex min-w-0 flex-col gap-4">
          <Heading>{m.dl_req_title()}</Heading>
          <dl className="grid grid-cols-[minmax(120px,max-content)_minmax(0,1fr)] gap-x-6 gap-y-3 text-body">
            <dt className="pt-[3px] text-label text-muted-foreground">{m.dl_req_system()}</dt>
            <dd>{m.dl_req_system_value()}</dd>
            <dt className="pt-[3px] text-label text-muted-foreground">{m.dl_req_rights()}</dt>
            <dd>{m.dl_req_rights_value()}</dd>
          </dl>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Heading>{m.dl_uninstall_title()}</Heading>
          <Text>{m.dl_uninstall_how()}</Text>
          <Text>{m.dl_uninstall_data()}</Text>
        </div>
      </Container>
    </>
  )
}
