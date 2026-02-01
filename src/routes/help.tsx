import { createFileRoute } from '@tanstack/react-router'
import {
  RiGamepadLine,
  RiRadarLine,
  RiTimeLine,
  RiQuestionLine,
  RiDatabase2Line,
} from '@remixicon/react'

import * as m from '@/paraglide/messages'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

export const Route = createFileRoute('/help')({
  component: HelpPage,
})

function HelpPage() {
  return (
    <div className="h-full overflow-y-auto p-4">
      <h1 className="text-2xl font-bold">{m.help_title()}</h1>
      <p className="text-muted-foreground mt-2">{m.help_description()}</p>

      <div className="mt-6">
        <h2 className="text-lg font-semibold">{m.help_quickstart_title()}</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <QuickStartCard
            icon={<RiGamepadLine className="size-5" />}
            title={m.help_quickstart_scan()}
            description={m.help_quickstart_scan_desc()}
            step={1}
          />
          <QuickStartCard
            icon={<RiRadarLine className="size-5" />}
            title={m.help_quickstart_monitor()}
            description={m.help_quickstart_monitor_desc()}
            step={2}
          />
          <QuickStartCard
            icon={<RiTimeLine className="size-5" />}
            title={m.help_quickstart_sessions()}
            description={m.help_quickstart_sessions_desc()}
            step={3}
          />
        </div>
      </div>

      <Separator className="my-8" />

      <div>
        <h2 className="text-lg font-semibold">{m.help_glossary_title()}</h2>
        <div className="mt-3 grid gap-3">
          <GlossaryItem term={m.help_glossary_asn()} definition={m.help_glossary_asn_desc()} />
          <GlossaryItem term={m.help_glossary_ttl()} definition={m.help_glossary_ttl_desc()} />
          <GlossaryItem
            term={m.help_glossary_traceroute()}
            definition={m.help_glossary_traceroute_desc()}
          />
          <GlossaryItem
            term={m.help_glossary_problem_hop()}
            definition={m.help_glossary_problem_hop_desc()}
          />
          <GlossaryItem
            term={m.help_glossary_ip_period()}
            definition={m.help_glossary_ip_period_desc()}
          />
          <GlossaryItem
            term={m.help_glossary_packet_loss()}
            definition={m.help_glossary_packet_loss_desc()}
          />
        </div>
      </div>

      <Separator className="my-8" />

      <div>
        <h2 className="text-lg font-semibold">{m.help_faq_title()}</h2>
        <div className="mt-3 grid gap-3">
          <FaqItem
            question={m.help_faq_no_data_collection()}
            answer={m.help_faq_no_data_collection_answer()}
          />
          <FaqItem
            question={m.help_faq_no_geo()}
            answer={m.help_faq_no_geo_answer()}
          />
          <FaqItem
            question={m.help_faq_manual_game()}
            answer={m.help_faq_manual_game_answer()}
          />
          <FaqItem
            question={m.help_faq_high_latency()}
            answer={m.help_faq_high_latency_answer()}
          />
        </div>
      </div>

      <Separator className="my-8" />

      <div>
        <h2 className="text-lg font-semibold">{m.help_data_title()}</h2>
        <p className="text-muted-foreground mt-2 text-sm">{m.help_data_description()}</p>
        <div className="mt-3 grid gap-3">
          <ApiItem
            name={m.help_data_ip_api()}
            description={m.help_data_ip_api_desc()}
            url="http://ip-api.com"
          />
        </div>
      </div>
    </div>
  )
}

function QuickStartCard({
  icon,
  title,
  description,
  step,
}: {
  icon: React.ReactNode
  title: string
  description: string
  step: number
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-bold">
            {step}
          </div>
          <div className="flex items-center gap-2">
            {icon}
            <CardTitle>{title}</CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>
      </CardContent>
    </Card>
  )
}

function GlossaryItem({ term, definition }: { term: string; definition: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <h3 className="text-sm font-semibold">{term}</h3>
        <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{definition}</p>
      </CardContent>
    </Card>
  )
}

function FaqItem({ question, answer }: { question: string; answer: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-start gap-2">
          <RiQuestionLine className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <div>
            <h3 className="text-sm font-semibold">{question}</h3>
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{answer}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ApiItem({ name, description, url }: { name: string; description: string; url: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-start gap-2">
          <RiDatabase2Line className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">{name}</h3>
              <Badge variant="outline" className="text-xs">
                {url}
              </Badge>
            </div>
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{description}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
