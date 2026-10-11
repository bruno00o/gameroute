export const paraglideOptions = {
  project: './project.inlang',
  outdir: './src/paraglide',
  outputStructure: 'message-modules' as const,
  strategy: ['url', 'baseLocale'] as ('url' | 'baseLocale')[],
}
