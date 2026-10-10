const SHORT_NAMES: [RegExp, string][] = [
  [/radiotelephone|\bSFR\b|numericable|completel/i, 'SFR'],
  [/\borange\b|france telecom/i, 'Orange'],
  [/^(free( pro| mobile)?( sas)?|proxad.*)$/i, 'Free'],
  [/bouygues/i, 'Bouygues'],
  [/\bRETN\b/i, 'RETN'],
  [/arelion/i, 'Arelion'],
  [/\btelia\b/i, 'Telia'],
  [/cogent/i, 'Cogent'],
  [/zayo/i, 'Zayo'],
  [/level ?3|lumen|centurylink/i, 'Lumen'],
  [/hurricane electric/i, 'Hurricane Electric'],
  [/\bGTT\b/i, 'GTT'],
  [/\bNTT\b/i, 'NTT'],
  [/tata communications/i, 'Tata'],
  [/microsoft/i, 'Microsoft'],
  [/amazon|\bAWS\b/i, 'Amazon'],
  [/cloudflare/i, 'Cloudflare'],
  [/google/i, 'Google'],
  [/akamai/i, 'Akamai'],
  [/fastly/i, 'Fastly'],
  [/riot games/i, 'Riot Games'],
  [/valve/i, 'Valve'],
  [/blizzard/i, 'Blizzard'],
  [/electronic arts/i, 'Electronic Arts'],
  [/epic games/i, 'Epic Games'],
  [/ubisoft/i, 'Ubisoft'],
  [/\bOVH/i, 'OVHcloud'],
  [/i3d\.net/i, 'i3D.net'],
  [/g-?core/i, 'Gcore'],
  [/telef[oó]nica/i, 'Telefónica'],
  [/vodafone/i, 'Vodafone'],
  [/deutsche telekom/i, 'Deutsche Telekom'],
  [/proximus/i, 'Proximus'],
  [/british telecommunications/i, 'BT'],
  [/virgin media/i, 'Virgin Media'],
  [/comcast/i, 'Comcast'],
]

const LEGAL_SUFFIX =
  /[\s,]+(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|gmbh|ag|s\.?a|s\.?a\.?s|s\.?a\.?u|sarl|s\.?p\.?a|b\.?v|n\.?v|a\/s|ab|oy|plc|pty|srl|s\.?l|kg)\.?$/i

export function shortOperatorName(raw: string | null | undefined): string | null {
  const name = raw?.trim()
  if (!name) return null

  for (const [pattern, short] of SHORT_NAMES) {
    if (pattern.test(name)) return short
  }

  let cleaned = name
  for (let previous = ''; previous !== cleaned; ) {
    previous = cleaned
    cleaned = cleaned
      .replace(LEGAL_SUFFIX, '')
      .replace(/-AS\d*$/i, '')
      .replace(/[\s,.-]+$/, '')
  }
  return cleaned || name
}
