interface PageHead {
  title: string
  description?: string
  noindex?: boolean
}

export function pageHead({ title, description, noindex }: PageHead) {
  return {
    meta: [
      { title },
      ...(description ? [{ name: 'description', content: description }] : []),
      ...(noindex ? [{ name: 'robots', content: 'noindex, nofollow' }] : []),
    ],
  }
}
