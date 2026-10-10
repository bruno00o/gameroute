# Changelog

## [0.1.19](https://github.com/bruno00o/gameroute/compare/v0.1.18...v0.1.19) (2026-10-10)


### Features

* **alerts:** sync the language to the backend and announce the end of a match ([289648f](https://github.com/bruno00o/gameroute/commit/289648f3981f9b5dab9d562b68eb4c8cc9c064a1))
* **alerts:** warn when the connection stays critical during a match ([1cfa5f7](https://github.com/bruno00o/gameroute/commit/1cfa5f710cda147edc8fbeb5614be009dfca3eb8))
* **export:** add a command to write a PDF file ([009d858](https://github.com/bruno00o/gameroute/commit/009d858a5be76b60baa574b2989a8572e15b443b))
* **format:** add clock, day and elapsed time formats ([345cf97](https://github.com/bruno00o/gameroute/commit/345cf972673d1ceb6dd70ea0a019ef8ab80c1c88))
* **game-logs:** read in-match pings from League and VALORANT logs ([19eb1cf](https://github.com/bruno00o/gameroute/commit/19eb1cf5f7ad14935616a54cdab7e56de7ffb405))
* **game-logs:** skip game logs already scanned for a session ([2e3a801](https://github.com/bruno00o/gameroute/commit/2e3a801c0de61d26f1d1f94665fcac905e55830b))
* **game-logs:** store game pings and follow them during matches ([455b92f](https://github.com/bruno00o/gameroute/commit/455b92f0ae1337d1db2cac3b6e6c32e0e1355887))
* **games:** add fixed network profiles to the game list ([ab31372](https://github.com/bruno00o/gameroute/commit/ab31372718f5eede95aff0dd2fecde2d76579236))
* **games:** pick the game from one dropdown with match counts and search ([3b9972c](https://github.com/bruno00o/gameroute/commit/3b9972c4806d653aebd486febc6c0076ae430c14))
* **games:** rebuild the games screen around network profile and summary ([061a209](https://github.com/bruno00o/gameroute/commit/061a209a59af5e60737336b0f478b94ce533e78f))
* **help:** explain statuses against the usual ping ([d8573f7](https://github.com/bruno00o/gameroute/commit/d8573f7f05dd17d31970991d6fb2286ae3c81ef7))
* **help:** rebuild help with search, glossary and expandable questions ([5692a92](https://github.com/bruno00o/gameroute/commit/5692a9293a7ebe77b0ea3b5f1a4d07a38897965b))
* **history:** compute the hour by day grid in local time ([4ba33c1](https://github.com/bruno00o/gameroute/commit/4ba33c115ba4b3fec53370c9d6c76e96833a012e))
* **history:** grade the week grid from a calm tint to amber and red ([30acac7](https://github.com/bruno00o/gameroute/commit/30acac7a57bc50dccc19bdf8f12b1f38022be9d0))
* **history:** replace the trends charts with the hour by day grid ([fa6d59a](https://github.com/bruno00o/gameroute/commit/fa6d59ae68709efa699e3ad402ca17cf7927c158))
* **home:** open on a weekly verdict and a table of servers against their usual ping ([0616ca4](https://github.com/bruno00o/gameroute/commit/0616ca48f207b0305464ef67aec8808dbba629d0))
* **home:** say when a server ping was measured by the game ([8d225e6](https://github.com/bruno00o/gameroute/commit/8d225e63ca867d4eee25f1c563a6d282366a990b))
* **icons:** move the app icon to the v2 planet logo ([774e86e](https://github.com/bruno00o/gameroute/commit/774e86e9e5cde24988768b0ad477aa012196c0ee))
* **insights:** summarize each server against its usual ping ([5ecdb3e](https://github.com/bruno00o/gameroute/commit/5ecdb3e4a0133ce2201367c9a7d4c130fcb587d3))
* **live-probe:** add live probe types and wrappers ([50ab948](https://github.com/bruno00o/gameroute/commit/50ab948b3d02b849cf67f9ab988527c9ebaea0e1))
* **live-probe:** probe the access floor and a region beacon every second during matches ([c2e1a9e](https://github.com/bruno00o/gameroute/commit/c2e1a9ec558efbe9aa0a0469a1899b9440758a8d))
* **live-probe:** probe the box and the last ISP router during the match ([9788129](https://github.com/bruno00o/gameroute/commit/978812970aaaaea7122bd6c786d389b328ca321c))
* **live-status:** add the live status types and wrappers ([0737975](https://github.com/bruno00o/gameroute/commit/0737975e3e64ee7a040adddbaacd6bf8fb34a351))
* **live-status:** rate the running match with hysteresis and locate the fault ([ab6ea25](https://github.com/bruno00o/gameroute/commit/ab6ea2564b76ac45c9df97736964f8dba6d7d7ed))
* **live:** add the live screen with waiting, readout, sparkline and frozen states ([355588c](https://github.com/bruno00o/gameroute/commit/355588c6f9b0d10c2ad11653b3d4c2d394738b85))
* **live:** add the verdict by zone, the measured points, the flows and the match timeline ([51e4428](https://github.com/bruno00o/gameroute/commit/51e44280301619bf785cdfeb6d4488ea476486dd))
* **match:** add the match screen with its trace, route and thresholds ([8d83cd4](https://github.com/bruno00o/gameroute/commit/8d83cd40d57c8af45eb6acc80e271a523bc369a2))
* **matches:** prefer the ping measured by the game over the trace ([9d1752a](https://github.com/bruno00o/gameroute/commit/9d1752a99e8d9ae59a05d1e0860d26fdeb1092a3))
* **match:** explain a status against the usual ping when there is one ([b7e97f1](https://github.com/bruno00o/gameroute/commit/b7e97f14e25f9dd09c1c2484180e6831d5144190))
* **match:** open each match on its own screen and redirect old period links ([83be8cc](https://github.com/bruno00o/gameroute/commit/83be8cc8a44596e4859161339630cb201ace3a9a))
* **match:** say when a match ping was measured by the game ([120abaa](https://github.com/bruno00o/gameroute/commit/120abaac0ccf56f70ac013d4e0d608e8cd0bc6a6))
* **mini:** show the live reading, status and last minute in the mini window ([0e9b1f5](https://github.com/bruno00o/gameroute/commit/0e9b1f5f7aa272da377ecee5f9eec0260f2b6c73))
* **monitoring:** report UDP sockets of each running program ([5034fd3](https://github.com/bruno00o/gameroute/commit/5034fd3b3c06c206fa5e36df54552a8fc1d5f4ac))
* **nav:** follow the v2 screens in the sidebar ([502c896](https://github.com/bruno00o/gameroute/commit/502c8960ff45ba45cff004a31358662fca2ee83a))
* **nav:** move monitoring into the sidebar footer ([fb2cd20](https://github.com/bruno00o/gameroute/commit/fb2cd207f18c3660ca8d60be94d0c1a47566d416))
* **network:** resolve router names through the system resolver ([fd3a89b](https://github.com/bruno00o/gameroute/commit/fd3a89bd598ac69ff816b784a2bff1557bfc37ea))
* **recap:** open the post-match recap from the end-of-match toast ([c7ebf65](https://github.com/bruno00o/gameroute/commit/c7ebf65d738503cb98d0ee07f0dda398b84af57a))
* **recap:** show the post-match recap, the match timeline and a home entry point ([6868a1a](https://github.com/bruno00o/gameroute/commit/6868a1a211b2bb140bc2907ffcf1b7161f16c9ea))
* **recap:** summarise a finished match from its probes, game pings and incidents ([e86660c](https://github.com/bruno00o/gameroute/commit/e86660c791029956000e196d7d3d6c50653f6224))
* **reports:** add a button to save the report as a PDF ([8811b37](https://github.com/bruno00o/gameroute/commit/8811b3704509efdbbe3d5fc57e3247c87eaede72))
* **reports:** add the report screen and its navigation entry ([274a0e0](https://github.com/bruno00o/gameroute/commit/274a0e03a8d5dd0374ee683811bf8f93a5c0c95c))
* **reports:** generate the support report as plain text ([75c6e14](https://github.com/bruno00o/gameroute/commit/75c6e14d8a2e5c4ef89be28ccc6a8dee08e364c2))
* **reports:** lay out the report as an A4 PDF ([23a1a60](https://github.com/bruno00o/gameroute/commit/23a1a603c355c7153533973ee3425624ae65b0ab))
* **reports:** use the ping measured by the game and keep region pings as context ([3f0e8ea](https://github.com/bruno00o/gameroute/commit/3f0e8ea257060a9a14e4f1b0b12998544285717c))
* **route:** add route strip and hop list components ([aea55d5](https://github.com/bruno00o/gameroute/commit/aea55d5e7ebfff91ca36bff96e7d54347cf6734b))
* **route:** add short names for common network operators ([0f86818](https://github.com/bruno00o/gameroute/commit/0f868187576f23dc8d0f490cc938fcc115303185))
* **route:** give each route zone its own hue across strip, hops, contributions and verdict ([42ff614](https://github.com/bruno00o/gameroute/commit/42ff614f7efd65fb791db66d15763076af229a3b))
* **route:** group traceroute hops by operator ([e6d6b0f](https://github.com/bruno00o/gameroute/commit/e6d6b0f678e2b40bf238af1fe99ef54adf63284f))
* **route:** read the usual route and its changes from the match traces ([e5411e7](https://github.com/bruno00o/gameroute/commit/e5411e7d496f860d63247f53b07694ff442fe990))
* **route:** replace the network screen with the route screen ([72aa419](https://github.com/bruno00o/gameroute/commit/72aa419944b2f8d34b244c5eb604bd59483236b7))
* **route:** replace the online map with an offline themed route map ([64083a2](https://github.com/bruno00o/gameroute/commit/64083a20e0fce235860479da60e2ba13f046a1c6))
* **route:** total the usual route with the ping measured by the game ([395cb44](https://github.com/bruno00o/gameroute/commit/395cb4410f9543f841728745ca0f2a4697d1a8ac))
* **session:** add verdict, match timeline and match table ([e7558a9](https://github.com/bruno00o/gameroute/commit/e7558a9152774550d5742a907b5f9a44b4b47415))
* **session:** copy a readable diagnostic and add matches to the AI export ([22212ba](https://github.com/bruno00o/gameroute/commit/22212babe4ac1ff7eccf182f8bbcfb1a27f89b0f))
* **session:** rebuild the session screen around its matches ([417e0a9](https://github.com/bruno00o/gameroute/commit/417e0a91939c1eb701c198f6b4f37db9f153bcbc))
* **sessions:** flag session ends estimated after a restart ([481f057](https://github.com/bruno00o/gameroute/commit/481f057c20ca7a9b0b23d9be2a01ef73af7fb120))
* **sessions:** list sessions with their matches and network status ([93b417b](https://github.com/bruno00o/gameroute/commit/93b417b9030656adc43f02c1a194dfeb2ccb7991))
* **sessions:** list the matches of a session ([3b679a5](https://github.com/bruno00o/gameroute/commit/3b679a5174d895f4335f0bbec24ce02e2028d424))
* **sessions:** prepare a report from the session menu ([2c6c621](https://github.com/bruno00o/gameroute/commit/2c6c621680a2b3524721111dda08ed31802e97e8))
* **sessions:** rate every match against the usual ping of its server ([2806a5d](https://github.com/bruno00o/gameroute/commit/2806a5daef8d25a6194cab50f1d5e2637d137e2a))
* **sessions:** rebuild the session list with filters and network status ([4b61f5d](https://github.com/bruno00o/gameroute/commit/4b61f5d1d94f19719a794f3bf9677281d5cddb7e))
* **settings:** add the alerts section ([acf3a8e](https://github.com/bruno00o/gameroute/commit/acf3a8e892974b9e2c37fec8b9d97dd1bcdca85b))
* **settings:** open the mini window and keep it on top only on request ([51caada](https://github.com/bruno00o/gameroute/commit/51caadac04750af02a612d4af7b5ec122e10a4c7))
* **settings:** save settings on disk, keep sessions a year and add data controls ([4e67e63](https://github.com/bruno00o/gameroute/commit/4e67e638d467c7e0dce83252bd21b868e6113122))
* **settings:** split settings into general, capture and privacy screens ([1079054](https://github.com/bruno00o/gameroute/commit/1079054e672372eeeeeefd582c304b7ea8082cd7))
* **settings:** switch the in-match probes on or off ([38ce254](https://github.com/bruno00o/gameroute/commit/38ce25439a80c8618e374fa41dbfd3fc00094d65))
* **severity:** compute status thresholds in rust ([7ce73fa](https://github.com/bruno00o/gameroute/commit/7ce73faa73d68d8ccce0d87c3c98974d451195fc))
* **trace:** add a command to trace an address without saving it ([500d100](https://github.com/bruno00o/gameroute/commit/500d1002dfd70dcf364334eda9e8bcba009f061a))
* **trace:** rebuild the trace screen on the hop list and the route strip ([a0d15c6](https://github.com/bruno00o/gameroute/commit/a0d15c6f9500fea43b4d801909b1e2c935f93b2e))
* **trace:** send the role, the final hops and the route with the trace events ([52a7229](https://github.com/bruno00o/gameroute/commit/52a7229e52fb8f292195611dc336227b8d8d3042))
* **tray:** add a non-activating mini window and a translated live tray ([3614631](https://github.com/bruno00o/gameroute/commit/3614631c13e532f317b2de29f88ec209fc74e1f0))
* **tray:** draw the tray states with the v2 planet logo and a status dot ([6a52388](https://github.com/bruno00o/gameroute/commit/6a52388cb0d47edfccf9f8323c223a106fa402f9))
* **types:** add operator route to traceroute types ([bc427ef](https://github.com/bruno00o/gameroute/commit/bc427efa65f8de3c2cb84fc99190cbe042e77328))
* **types:** add session matches to the ipc layer ([10472c0](https://github.com/bruno00o/gameroute/commit/10472c0e76fb35876c7fd4160aac532412f28008))
* **ui:** add error and not found screens ([3aaf274](https://github.com/bruno00o/gameroute/commit/3aaf2741336dde6eef2a8e6502f4b1f6faa5c44d))
* **ui:** add live badge ([5b69af1](https://github.com/bruno00o/gameroute/commit/5b69af16674d6f35222774b05a4f60235e7562dc))
* **ui:** add notice and segmented controls ([ffde22e](https://github.com/bruno00o/gameroute/commit/ffde22e7763c730d389a9122a85443c7429704a5))
* **ui:** add panel, data table, empty state and fact row ([452e3f9](https://github.com/bruno00o/gameroute/commit/452e3f9e8425d2c7a163f76d72a020cad1443a3d))
* **ui:** add severity glyph and status pill ([f1234c9](https://github.com/bruno00o/gameroute/commit/f1234c9f21ca93eb0b5673906543c1660d0f6018))
* **ui:** adopt v2 colour, radius and type tokens ([6d1a6ce](https://github.com/bruno00o/gameroute/commit/6d1a6ce776d1b7a76c09dd7fb0ae78620c8b1baf))
* **ui:** bundle archivo and jetbrains mono ([3434d66](https://github.com/bruno00o/gameroute/commit/3434d663b212abbbe9fb8a74e819e754586d5bd9))
* **ui:** draw the logo mark in ink ([bff0725](https://github.com/bruno00o/gameroute/commit/bff0725249b2f4ba4bb431dacf53da41fe1c5ab7))
* **ui:** format days and times per language ([ae11fba](https://github.com/bruno00o/gameroute/commit/ae11fba859f4af5f29260139234fcefb8c170347))
* **ui:** format numbers and units per language ([206e612](https://github.com/bruno00o/gameroute/commit/206e612720619704ddef99d72d15d3f3744ba6dc))
* **ui:** restyle buttons, switches and text fields for v2 ([439dd84](https://github.com/bruno00o/gameroute/commit/439dd84492ee984d4f9804084a269f94bf29f778))
* **ui:** restyle toasts for v2 ([678f38c](https://github.com/bruno00o/gameroute/commit/678f38c985f850b4430c75cf55e05cb276ceed3d))
* **updater:** offer updates in a translated dialog with release notes ([6dfbfe1](https://github.com/bruno00o/gameroute/commit/6dfbfe1a37c30a28b84c0f31d1b9cc9673848819))
* **welcome:** replace the first launch cards with four steps ([52de35b](https://github.com/bruno00o/gameroute/commit/52de35bc0d8ac4656b38374ee54059697bc814f8))


### Bug Fixes

* **game-logs:** make log time handling independent of the machine timezone ([7a829d7](https://github.com/bruno00o/gameroute/commit/7a829d7d585f98ab3aa7170acb82e971f719f1c2))
* **games:** give League of Legends the Riot UDP range recognised by flow detection ([8ff83f7](https://github.com/bruno00o/gameroute/commit/8ff83f7649af6e50db56a7463097d9bbe5379447))
* **games:** keep profile listing test-only and align the home fixture ([2d18a92](https://github.com/bruno00o/gameroute/commit/2d18a92cd16ca638c9abeb3839fac61c9736ccca))
* **help:** use a neutral ISP in the example route ([fbb8b2f](https://github.com/bruno00o/gameroute/commit/fbb8b2f0e27410f7c27870a217b67ddf22885419))
* **insights:** rate servers on the last seven days against the matches played before ([1cd620b](https://github.com/bruno00o/gameroute/commit/1cd620bbbf60d08c163cbb9318d7f7b934041c6c))
* **insights:** read every ping at the last responding hop ([2f041c2](https://github.com/bruno00o/gameroute/commit/2f041c2337852660a786035eb34faafb9e5b5f9e))
* **live-probe:** read IPv6 reply bytes with fixed-size chunks ([4a8a3ca](https://github.com/bruno00o/gameroute/commit/4a8a3cab56200790a57581f173c2dda2c51b41aa))
* **live-status:** align with the merged trace and probe settings ([5963990](https://github.com/bruno00o/gameroute/commit/596399092176570c04bebd346bf24a3b8142d8b8))
* **live:** drop stored router incidents the region beacon saw clean ([3d11afa](https://github.com/bruno00o/gameroute/commit/3d11afaa0a253eb7b20cc18831ea2358e2a73fc8))
* **live:** ignore probe loss the region beacon did not see ([39bd1bf](https://github.com/bruno00o/gameroute/commit/39bd1bfbc5f561c4a05d4a3c9c816947926534c9))
* **live:** ignore spikes only the last visible router answers ([20fa34e](https://github.com/bruno00o/gameroute/commit/20fa34ea38dc16a0c3a2a3d2a14ca1bb0735e3ab))
* **live:** recheck stored home loss incidents against the region beacon ([977760f](https://github.com/bruno00o/gameroute/commit/977760f2c4a57ccdbb398111b6df4e7b1a9cc01c))
* **matches:** keep the region pings of the game as context only ([7e37e80](https://github.com/bruno00o/gameroute/commit/7e37e80dc47fa0d8a3b684c48d33c4a0d929be29))
* **nav:** let the keyboard reach breadcrumb links ([5c5d3c5](https://github.com/bruno00o/gameroute/commit/5c5d3c5dfe94028458097527170488702002cfbf))
* **privacy:** disclose the in-match probes ([0ee94d3](https://github.com/bruno00o/gameroute/commit/0ee94d3bf7215ce9c05fb9377372d351021b3a3e))
* **reports:** draw the PDF route segments in the grey route tokens ([56c9822](https://github.com/bruno00o/gameroute/commit/56c9822b20ae463875593959e2a6c6ad1a0bb384))
* **reports:** list problem matches first, name the game for support and zone hops like the route ([e25a339](https://github.com/bruno00o/gameroute/commit/e25a339580d3dc21cc634117c24fe771241203a6))
* **report:** write hop remarks as their own sentence ([ee7667b](https://github.com/bruno00o/gameroute/commit/ee7667bfa4e3e4594f1447ac09e86c6d57f4d74c))
* **route:** build route history from trace samples ([ccf9ca6](https://github.com/bruno00o/gameroute/commit/ccf9ca63c3110b77eb17dca119e1e29fc22960ec))
* **route:** explain the deduced last stretch in the route note ([2e2730b](https://github.com/bruno00o/gameroute/commit/2e2730b6567e4a63ac696cbb98539e588995c1f8))
* **route:** hide the city of Riot servers everywhere ([f6ca418](https://github.com/bruno00o/gameroute/commit/f6ca418c1da75eab4e9446a0c694f3ffd2e151b2))
* **service:** stop logging status checks as request errors ([4868a17](https://github.com/bruno00o/gameroute/commit/4868a175778d8578c35c89619f2a02878a55598b))
* **severity:** ignore a last router that answers its own pings late ([dbe9408](https://github.com/bruno00o/gameroute/commit/dbe94081a4564604f0b3db8f33a838ee3905f13f))
* **theme:** follow Windows when it switches between light and dark ([8165885](https://github.com/bruno00o/gameroute/commit/81658859d296117c6772ae0639cbe0285af27bc1))
* **trace:** ignore loss confined to a silent destination's own network ([7152f0c](https://github.com/bruno00o/gameroute/commit/7152f0cefde2768055ab2cc49f79180f122fd551))
* **ui:** drop the middle-dot separators from the interface ([fcba2fd](https://github.com/bruno00o/gameroute/commit/fcba2fd5b71713a784cf1461f186be28d3ac8b3b))
* **ui:** replace hard-coded colours with v2 tokens ([9457e90](https://github.com/bruno00o/gameroute/commit/9457e90fd25b06068eb5a3aaeb8ef9f22d578ac8))
* **updater:** let post-match traceroutes finish before offering an update ([782778c](https://github.com/bruno00o/gameroute/commit/782778c812d479e7a79bf697e78cde13f625af58))
* **updater:** translate the update dialog ([c643b3c](https://github.com/bruno00o/gameroute/commit/c643b3c058899d92ea67f33ad36debeab33f637c))
* **updater:** wait for the match to end before offering an update ([771fcc8](https://github.com/bruno00o/gameroute/commit/771fcc8b0749b39ee15151e5871194a0d1b494e1))
* **welcome:** load nothing before the first launch flow is done ([b7e1968](https://github.com/bruno00o/gameroute/commit/b7e19682ea06d0dd8cefc34bde0f05a1e3563d74))


### Performance Improvements

* **live:** poll the ongoing session less and refresh it when a match starts ([462379f](https://github.com/bruno00o/gameroute/commit/462379f70977462d90d7937848d060f802ac68a7))

## [0.1.18](https://github.com/bruno00o/gameroute/compare/v0.1.17...v0.1.18) (2026-10-08)


### Features

* **capture:** recognise riot game servers by operator and port ([5164640](https://github.com/bruno00o/gameroute/commit/516464036562641a0ab1d1c4ab0858c7f41061ee))
* **sessions:** merge fragmented matches from earlier sessions on startup ([ecdb7ef](https://github.com/bruno00o/gameroute/commit/ecdb7ef65de6e2dbfef2fe6acbd0de5c68c94b20))


### Bug Fixes

* **i18n:** describe the app's real outbound connections ([00596b6](https://github.com/bruno00o/gameroute/commit/00596b6a5af65b322437a0e2f1911454fccb4ccb))
* **sessions:** back up the database before merging match fragments ([371aea5](https://github.com/bruno00o/gameroute/commit/371aea5ddc168ee4c80075489ec2a2c876605899))
* **sessions:** merge short gaps within a match ([9505dd3](https://github.com/bruno00o/gameroute/commit/9505dd336d0d603f8e18aea726807a21cb8efd72))

## [0.1.17](https://github.com/bruno00o/gameroute/compare/v0.1.16...v0.1.17) (2026-10-08)


### Features

* **capture:** persist the operator of captured addresses ([1671a5f](https://github.com/bruno00o/gameroute/commit/1671a5f11c340ec90bc2a2bf01d93166b9ad345e))


### Bug Fixes

* **capture:** count real packets per period ([c1b7971](https://github.com/bruno00o/gameroute/commit/c1b7971f03b59fc4e9d50a4cf0d8f553d6671552))
* **capture:** send 10 probes per hop in protocol traceroutes ([b300d53](https://github.com/bruno00o/gameroute/commit/b300d53536785f627ad684e2767d931719853b8f))
* **db:** recompute stored problem hops with the persistent loss rule ([7748f04](https://github.com/bruno00o/gameroute/commit/7748f04d71bf1a49af2486341ef7f2668ccb2ea0))
* **traceroute:** flag persistent latency instability instead of distance jumps ([dd7e2f4](https://github.com/bruno00o/gameroute/commit/dd7e2f454ad7b577f51ba53bb80fd10d07646549))
* **traceroute:** only flag loss that persists to the destination ([d68dda4](https://github.com/bruno00o/gameroute/commit/d68dda45b384e871e47aef034670636bc278f6e2))

## [0.1.16](https://github.com/bruno00o/gameroute/compare/v0.1.15...v0.1.16) (2026-10-08)


### Features

* **capture:** write service logs to ProgramData ([5b4a8a5](https://github.com/bruno00o/gameroute/commit/5b4a8a5234065b5e582b6dfa30dc053c495e8584))


### Bug Fixes

* **capture:** let the service stop while waiting for clients ([3bd6dbb](https://github.com/bruno00o/gameroute/commit/3bd6dbb090880a8f6df80b71f347a9f68d60d14d))
* **capture:** stop counting lost probes as zero-latency samples ([7185ab6](https://github.com/bruno00o/gameroute/commit/7185ab621f4c759cadd5110d7b10782f447eed15))
* **installer:** stop the capture service before copying files ([1fbcef6](https://github.com/bruno00o/gameroute/commit/1fbcef68a1090f9ded8f4597a6c836380474ba02))

## [0.1.15](https://github.com/bruno00o/gameroute/compare/v0.1.14...v0.1.15) (2026-10-07)


### Features

* **sessions:** label voice chat flows separately from game servers ([36ff310](https://github.com/bruno00o/gameroute/commit/36ff310a14b0c623465da7176c37c2c33990438d))
* **traceroute:** trace game servers during matches ([ebf6799](https://github.com/bruno00o/gameroute/commit/ebf679966571019ac1195007e0bd93cfbce21d33))


### Bug Fixes

* **capture:** let the service accept concurrent pipe clients ([54f0e3a](https://github.com/bruno00o/gameroute/commit/54f0e3a7be209833c0c16c18682f4d055718c242))
* **installer:** allow icmp replies for traceroute probes and restart the service on failure ([81f1286](https://github.com/bruno00o/gameroute/commit/81f12861bd2ce01ca50c393a4df49e1a29e800b4))
* **map:** declare geojson types explicitly ([f072ab1](https://github.com/bruno00o/gameroute/commit/f072ab1cc8193f5e6e4e629462994bc45db80486))
* **sessions:** close sessions left open by an unexpected exit ([9edb2fb](https://github.com/bruno00o/gameroute/commit/9edb2fbc06c18ad5807dfb40d2cb511bebf51660))

## [0.1.14](https://github.com/bruno00o/gameroute/compare/v0.1.13...v0.1.14) (2026-04-21)


### Features

* launch at Windows startup via tauri-plugin-autostart ([00fc792](https://github.com/bruno00o/gameroute/commit/00fc792c2c8a50f634bc030990b71e43d8dc805b))
* offline ASN and geolocation lookups via MaxMind GeoLite2 ([8840176](https://github.com/bruno00o/gameroute/commit/88401764a600129b88ed0415ecd0391ccdd45d62))


### Bug Fixes

* adopt new clippy lints from Rust 1.95 ([531e3ed](https://github.com/bruno00o/gameroute/commit/531e3ed5c29421fea4956bdf368acec3afdc7f1e))

## [0.1.13](https://github.com/bruno00o/gameroute/compare/v0.1.12...v0.1.13) (2026-03-14)


### Features

* add advanced mode toggle for simplified vs technical UI ([2f8aa66](https://github.com/bruno00o/gameroute/commit/2f8aa66df2caad1f1f5fd903b120b105e5e4abde))
* add analytics backend with network and insights commands ([62f5c2b](https://github.com/bruno00o/gameroute/commit/62f5c2b81669b607856b061270580f432ed470dd))
* add app layout with sidebar and routing ([d104bb2](https://github.com/bruno00o/gameroute/commit/d104bb2e8282533a983dca9cfd552113eb6dcb26))
* add capture service for privileged network operations ([fe5150a](https://github.com/bruno00o/gameroute/commit/fe5150a74db888f60b44a43a58d6fc621260d0c9))
* add custom app icon and branding ([0aed4fc](https://github.com/bruno00o/gameroute/commit/0aed4fcbc85af1030a8283c0289b959c9d3ebdc7))
* add dependencies, theme and shadcn/ui components ([2d28fc9](https://github.com/bruno00o/gameroute/commit/2d28fc9fce0bca7acb169ff9a80c4e6d628d0673))
* add frontend types, stores, hooks, and utilities ([6ea5c07](https://github.com/bruno00o/gameroute/commit/6ea5c07d2278cd0c643923194aa0dcc0fb1e139d))
* add frontend types, Tauri bindings, and utilities for game library ([3ca10b8](https://github.com/bruno00o/gameroute/commit/3ca10b864f05a03584afc57475c0dfa5e978d35c))
* add game and dashboard commands, refactor monitoring to use DB ([ae86bbd](https://github.com/bruno00o/gameroute/commit/ae86bbdd7a47e9c3884586d0f59a8af7c201e616))
* add game library with SQLite storage and Steam/Epic scanners ([cf6a140](https://github.com/bruno00o/gameroute/commit/cf6a140d8ea60dc3c6032ed4336ce1b456fcaf01))
* add game server detection and split network page by server type ([624b81f](https://github.com/bruno00o/gameroute/commit/624b81fd4681560165ae4f7ea6396222fad347ae))
* add interactive maps across the app with expandable fullscreen view ([e7f1dbb](https://github.com/bruno00o/gameroute/commit/e7f1dbbd55b0ab9bf5afba33f4150e0182e01fa5))
* add new shadcn/ui components ([6042631](https://github.com/bruno00o/gameroute/commit/60426310c11a9edef6bf13b2500d55ae12e6eb06))
* add onboarding, service health check, and system tray ([b07fcee](https://github.com/bruno00o/gameroute/commit/b07fceecef29340ff52a945d91fc77ecaf7b5590))
* add retry traceroutes button on session detail page ([eefdada](https://github.com/bruno00o/gameroute/commit/eefdada0b7cc62e932aba6285c0cd01b6eaa1efb))
* add Riot Games scanner (VALORANT, LoL, LoR, 2XKO) ([05b7d9f](https://github.com/bruno00o/gameroute/commit/05b7d9f05dedd66575604540b445502eac147df6))
* add Rust backend with database, services, and commands ([4028fcb](https://github.com/bruno00o/gameroute/commit/4028fcbf121d6e0d228a01d8b64ff1e78d4421cf))
* add session, monitoring, and traceroute UI components ([fe9564f](https://github.com/bruno00o/gameroute/commit/fe9564fbc30f937dc319e2a0f44eefb7dd913bff))
* auto-update via GitHub Releases and file-based crash logging ([f6e7241](https://github.com/bruno00o/gameroute/commit/f6e724163fffe57033d3b02a6cf82efed3efb910))
* build games library page and dashboard with i18n ([1c33c16](https://github.com/bruno00o/gameroute/commit/1c33c16b00e91cea8d894341bb85c1cc410038e4))
* build network, insights, and help pages with session enhancements ([c70ad61](https://github.com/bruno00o/gameroute/commit/c70ad619cb69715b6dca8e6445f083f42368b186))
* export to LLM/CSV, session comparison, search, and UX improvements ([452435c](https://github.com/bruno00o/gameroute/commit/452435ca777461c0b5fd52856b04eab74eb217a4))
* protocol-aware hybrid traceroute with early termination ([0e072ba](https://github.com/bruno00o/gameroute/commit/0e072bafbf994c1d833fa6598b6e1552d522addf))
* show traceroute protocol source and blocked destination in UI ([2110a90](https://github.com/bruno00o/gameroute/commit/2110a900c274ee221f3bf9a0ed0ac6053b0e6009))
* update routes, navigation, and i18n for monitoring features ([28cf7e7](https://github.com/bruno00o/gameroute/commit/28cf7e794d51b852e8c8bcf1c833550b9defcc26))
* use tracert.exe on Windows instead of trippy-core ([36d8e02](https://github.com/bruno00o/gameroute/commit/36d8e024749be45234f72c082b5fb6f016ea379a))
* UX improvements — network verdicts, route stability, tooltips, and accessibility ([331e204](https://github.com/bruno00o/gameroute/commit/331e20492521a87841a5b99951c3c536848bd5b3))


### Bug Fixes

* align empty state styling across pages ([8991374](https://github.com/bruno00o/gameroute/commit/89913745402311437e66d5b955a365695f8a1b51))
* backend robustness — race conditions, timeouts, validation, and session cleanup ([bd3e938](https://github.com/bruno00o/gameroute/commit/bd3e938dfdc68627f6e0168dd744080244e82463))
* build capture service sidecar before tauri build in CI ([ff836b2](https://github.com/bruno00o/gameroute/commit/ff836b2b57a2dec1d7c5e21171719f9109870412))
* create sidecar placeholder before building capture service in CI ([de8aef9](https://github.com/bruno00o/gameroute/commit/de8aef949c223aa3aa3addf8a3cc9f6349208352))
* downgrade recharts to version 2.15.4 in package.json and pnpm-lock.yaml ([82cf1b1](https://github.com/bruno00o/gameroute/commit/82cf1b15ef955b1593e194760fa27f40604e2619))
* enable tokio process/io-util features and add Windows CI check ([#5](https://github.com/bruno00o/gameroute/issues/5)) ([a37fc50](https://github.com/bruno00o/gameroute/commit/a37fc507cb7f8e6e4dcc638c4468290ec7c6455f))
* handle non-UTF-8 tracert output and reduce per-probe timeout ([#7](https://github.com/bruno00o/gameroute/issues/7)) ([89ee9b9](https://github.com/bruno00o/gameroute/commit/89ee9b98e33200a6f97a85b5e9f6cdea5857936a))
* handle Tauri error objects in monitoring UI ([d3f556e](https://github.com/bruno00o/gameroute/commit/d3f556e2bb27dba0f1ee73a2ea5d6b78ed4b2a67))
* improve network capture, traceroute concurrency, and config consistency ([#9](https://github.com/bruno00o/gameroute/issues/9)) ([c01468d](https://github.com/bruno00o/gameroute/commit/c01468db26504cebce4d79e95509f79b722f1c67))
* limit bundle targets to NSIS only ([53346ad](https://github.com/bruno00o/gameroute/commit/53346adf51866c3b429a96d093cf973a8bd9e515))
* map legends, neutral colors, and table layout improvements ([2e385f4](https://github.com/bruno00o/gameroute/commit/2e385f44670ae3a696ff79dd863999a34af75538))
* replace asChild with render prop for Base UI TooltipTrigger ([536883b](https://github.com/bruno00o/gameroute/commit/536883be6c87cf496bfd813ef45435618b8f9098))
* request admin privileges in NSIS installer for service install ([2e5a2e9](https://github.com/bruno00o/gameroute/commit/2e5a2e9c6ec39da935cc07d0342dff5b0db6a945))
* session details sidebar style ([dd00e49](https://github.com/bruno00o/gameroute/commit/dd00e49f7309b3761b472d453b4dd93b78af7754))
* session overview stats now scoped to game server routes only ([59fb873](https://github.com/bruno00o/gameroute/commit/59fb8738bfa83aed3bfb5d32bab037f4e5994d4d))
* set app identifier and add CSP ([d64750d](https://github.com/bruno00o/gameroute/commit/d64750de46df0c1964e847798d44696cbee5677a))
* show all problem hops in network tables, not just recurring ones ([ec29420](https://github.com/bruno00o/gameroute/commit/ec29420b65a70204b65ef18c181431b16741050d))
* UI polish — wrong error message, responsive grid, translations, map colors ([dadae0b](https://github.com/bruno00o/gameroute/commit/dadae0bd9c2d03807e0ec44428c97e35af01064a))
* update frontendDist path from '../build' to '../dist' in tauri.conf.json ([618aee1](https://github.com/bruno00o/gameroute/commit/618aee1685301ae78ce4048ba5d89a2dcbbf68aa))
* use privileged mode for traceroute on Windows ([2b649fd](https://github.com/bruno00o/gameroute/commit/2b649fdfdae8d14eb10766d17e02a0aca672b2fd))
* use strip_prefix instead of manual prefix stripping in tracert parser ([#3](https://github.com/bruno00o/gameroute/issues/3)) ([d6c0bc9](https://github.com/bruno00o/gameroute/commit/d6c0bc92b20f9f2165bd3711b9dadec924183ff5))
* use TOML jsonpath for Cargo.toml version bump in release-please ([d0eda46](https://github.com/bruno00o/gameroute/commit/d0eda464ab3fbf6fa0e502fe4f7ab1750bbb3428))

## [0.1.12](https://github.com/bruno00o/gameroute/compare/gameroute-v0.1.11...gameroute-v0.1.12) (2026-03-12)


### Features

* add game server detection and split network page by server type ([624b81f](https://github.com/bruno00o/gameroute/commit/624b81fd4681560165ae4f7ea6396222fad347ae))
* add interactive maps across the app with expandable fullscreen view ([e7f1dbb](https://github.com/bruno00o/gameroute/commit/e7f1dbbd55b0ab9bf5afba33f4150e0182e01fa5))
* UX improvements — network verdicts, route stability, tooltips, and accessibility ([331e204](https://github.com/bruno00o/gameroute/commit/331e20492521a87841a5b99951c3c536848bd5b3))


### Bug Fixes

* backend robustness — race conditions, timeouts, validation, and session cleanup ([bd3e938](https://github.com/bruno00o/gameroute/commit/bd3e938dfdc68627f6e0168dd744080244e82463))
* replace asChild with render prop for Base UI TooltipTrigger ([536883b](https://github.com/bruno00o/gameroute/commit/536883be6c87cf496bfd813ef45435618b8f9098))

## [0.1.11](https://github.com/bruno00o/gameroute/compare/gameroute-v0.1.10...gameroute-v0.1.11) (2026-03-07)


### Bug Fixes

* request admin privileges in NSIS installer for service install ([2e5a2e9](https://github.com/bruno00o/gameroute/commit/2e5a2e9c6ec39da935cc07d0342dff5b0db6a945))

## [0.1.10](https://github.com/bruno00o/gameroute/compare/gameroute-v0.1.9...gameroute-v0.1.10) (2026-03-07)


### Features

* add Riot Games scanner (VALORANT, LoL, LoR, 2XKO) ([05b7d9f](https://github.com/bruno00o/gameroute/commit/05b7d9f05dedd66575604540b445502eac147df6))


### Bug Fixes

* limit bundle targets to NSIS only ([53346ad](https://github.com/bruno00o/gameroute/commit/53346adf51866c3b429a96d093cf973a8bd9e515))

## [0.1.9](https://github.com/bruno00o/gameroute/compare/gameroute-v0.1.8...gameroute-v0.1.9) (2026-03-07)


### Bug Fixes

* create sidecar placeholder before building capture service in CI ([de8aef9](https://github.com/bruno00o/gameroute/commit/de8aef949c223aa3aa3addf8a3cc9f6349208352))

## [0.1.8](https://github.com/bruno00o/gameroute/compare/gameroute-v0.1.7...gameroute-v0.1.8) (2026-03-07)


### Bug Fixes

* build capture service sidecar before tauri build in CI ([ff836b2](https://github.com/bruno00o/gameroute/commit/ff836b2b57a2dec1d7c5e21171719f9109870412))

## [0.1.7](https://github.com/bruno00o/gameroute/compare/gameroute-v0.1.6...gameroute-v0.1.7) (2026-03-07)


### Features

* add capture service for privileged network operations ([fe5150a](https://github.com/bruno00o/gameroute/commit/fe5150a74db888f60b44a43a58d6fc621260d0c9))
* add onboarding, service health check, and system tray ([b07fcee](https://github.com/bruno00o/gameroute/commit/b07fceecef29340ff52a945d91fc77ecaf7b5590))
* protocol-aware hybrid traceroute with early termination ([0e072ba](https://github.com/bruno00o/gameroute/commit/0e072bafbf994c1d833fa6598b6e1552d522addf))
* show traceroute protocol source and blocked destination in UI ([2110a90](https://github.com/bruno00o/gameroute/commit/2110a900c274ee221f3bf9a0ed0ac6053b0e6009))

## [0.1.6](https://github.com/bruno00o/gameroute/compare/gameroute-v0.1.5...gameroute-v0.1.6) (2026-02-04)


### Bug Fixes

* improve network capture, traceroute concurrency, and config consistency ([#9](https://github.com/bruno00o/gameroute/issues/9)) ([c01468d](https://github.com/bruno00o/gameroute/commit/c01468db26504cebce4d79e95509f79b722f1c67))

## [0.1.5](https://github.com/bruno00o/gameroute/compare/gameroute-v0.1.4...gameroute-v0.1.5) (2026-02-03)


### Bug Fixes

* handle non-UTF-8 tracert output and reduce per-probe timeout ([#7](https://github.com/bruno00o/gameroute/issues/7)) ([89ee9b9](https://github.com/bruno00o/gameroute/commit/89ee9b98e33200a6f97a85b5e9f6cdea5857936a))

## [0.1.4](https://github.com/bruno00o/gameroute/compare/gameroute-v0.1.3...gameroute-v0.1.4) (2026-02-03)


### Bug Fixes

* enable tokio process/io-util features and add Windows CI check ([#5](https://github.com/bruno00o/gameroute/issues/5)) ([a37fc50](https://github.com/bruno00o/gameroute/commit/a37fc507cb7f8e6e4dcc638c4468290ec7c6455f))

## [0.1.3](https://github.com/bruno00o/gameroute/compare/gameroute-v0.1.2...gameroute-v0.1.3) (2026-02-03)


### Features

* add retry traceroutes button on session detail page ([eefdada](https://github.com/bruno00o/gameroute/commit/eefdada0b7cc62e932aba6285c0cd01b6eaa1efb))
* use tracert.exe on Windows instead of trippy-core ([36d8e02](https://github.com/bruno00o/gameroute/commit/36d8e024749be45234f72c082b5fb6f016ea379a))


### Bug Fixes

* use privileged mode for traceroute on Windows ([2b649fd](https://github.com/bruno00o/gameroute/commit/2b649fdfdae8d14eb10766d17e02a0aca672b2fd))
* use strip_prefix instead of manual prefix stripping in tracert parser ([#3](https://github.com/bruno00o/gameroute/issues/3)) ([d6c0bc9](https://github.com/bruno00o/gameroute/commit/d6c0bc92b20f9f2165bd3711b9dadec924183ff5))

## [0.1.2](https://github.com/bruno00o/gameroute/compare/gameroute-v0.1.1...gameroute-v0.1.2) (2026-02-01)


### Bug Fixes

* handle Tauri error objects in monitoring UI ([d3f556e](https://github.com/bruno00o/gameroute/commit/d3f556e2bb27dba0f1ee73a2ea5d6b78ed4b2a67))

## [0.1.1](https://github.com/bruno00o/gameroute/compare/gameroute-v0.1.0...gameroute-v0.1.1) (2026-02-01)


### Features

* add analytics backend with network and insights commands ([62f5c2b](https://github.com/bruno00o/gameroute/commit/62f5c2b81669b607856b061270580f432ed470dd))
* add app layout with sidebar and routing ([d104bb2](https://github.com/bruno00o/gameroute/commit/d104bb2e8282533a983dca9cfd552113eb6dcb26))
* add dependencies, theme and shadcn/ui components ([2d28fc9](https://github.com/bruno00o/gameroute/commit/2d28fc9fce0bca7acb169ff9a80c4e6d628d0673))
* add frontend types, stores, hooks, and utilities ([6ea5c07](https://github.com/bruno00o/gameroute/commit/6ea5c07d2278cd0c643923194aa0dcc0fb1e139d))
* add frontend types, Tauri bindings, and utilities for game library ([3ca10b8](https://github.com/bruno00o/gameroute/commit/3ca10b864f05a03584afc57475c0dfa5e978d35c))
* add game and dashboard commands, refactor monitoring to use DB ([ae86bbd](https://github.com/bruno00o/gameroute/commit/ae86bbdd7a47e9c3884586d0f59a8af7c201e616))
* add game library with SQLite storage and Steam/Epic scanners ([cf6a140](https://github.com/bruno00o/gameroute/commit/cf6a140d8ea60dc3c6032ed4336ce1b456fcaf01))
* add new shadcn/ui components ([6042631](https://github.com/bruno00o/gameroute/commit/60426310c11a9edef6bf13b2500d55ae12e6eb06))
* add Rust backend with database, services, and commands ([4028fcb](https://github.com/bruno00o/gameroute/commit/4028fcbf121d6e0d228a01d8b64ff1e78d4421cf))
* add session, monitoring, and traceroute UI components ([fe9564f](https://github.com/bruno00o/gameroute/commit/fe9564fbc30f937dc319e2a0f44eefb7dd913bff))
* build games library page and dashboard with i18n ([1c33c16](https://github.com/bruno00o/gameroute/commit/1c33c16b00e91cea8d894341bb85c1cc410038e4))
* build network, insights, and help pages with session enhancements ([c70ad61](https://github.com/bruno00o/gameroute/commit/c70ad619cb69715b6dca8e6445f083f42368b186))
* update routes, navigation, and i18n for monitoring features ([28cf7e7](https://github.com/bruno00o/gameroute/commit/28cf7e794d51b852e8c8bcf1c833550b9defcc26))


### Bug Fixes

* align empty state styling across pages ([8991374](https://github.com/bruno00o/gameroute/commit/89913745402311437e66d5b955a365695f8a1b51))
* downgrade recharts to version 2.15.4 in package.json and pnpm-lock.yaml ([82cf1b1](https://github.com/bruno00o/gameroute/commit/82cf1b15ef955b1593e194760fa27f40604e2619))
* session details sidebar style ([dd00e49](https://github.com/bruno00o/gameroute/commit/dd00e49f7309b3761b472d453b4dd93b78af7754))
* set app identifier and add CSP ([d64750d](https://github.com/bruno00o/gameroute/commit/d64750de46df0c1964e847798d44696cbee5677a))
* update frontendDist path from '../build' to '../dist' in tauri.conf.json ([618aee1](https://github.com/bruno00o/gameroute/commit/618aee1685301ae78ce4048ba5d89a2dcbbf68aa))
