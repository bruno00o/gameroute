# Changelog

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
