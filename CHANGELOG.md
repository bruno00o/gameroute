# Changelog

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
