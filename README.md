<p align="center">
  <img src="src/assets/logo.svg" width="80" alt="GameRoute logo" />
</p>

<h1 align="center">GameRoute</h1>

<p align="center">
  Monitor your game network connections in real time.
</p>

<p align="center">
  <a href="https://github.com/bruno00o/gameroute/releases/latest">Download</a> &middot;
  <a href="#features">Features</a> &middot;
  <a href="#getting-started">Getting Started</a> &middot;
  <a href="#development">Development</a>
</p>

---

GameRoute is a Windows desktop app that detects running games, captures server connections, runs traceroutes, and tracks network quality metrics over time. All data stays local — no telemetry, no cloud, no accounts.

## Features

- **Automatic game detection** — detects monitored games from Steam, Epic, and Riot libraries
- **Network capture** — captures server IPs via a lightweight Windows service (pktmon)
- **Traceroute analysis** — runs route tests to every server and flags trouble spots
- **Session history** — browse past sessions, compare quality between sessions
- **Network overview** — server map, stability trends, problem hop tracking
- **Export** — CSV export and "Copy for AI" to paste into ChatGPT/Claude/Gemini for diagnosis
- **Simple & Advanced modes** — toggle technical details on/off in Settings
- **Auto-update** — checks for new versions on startup via GitHub Releases
- **Multilingual** — English, French, Spanish

## Getting Started

### Install

1. Download the latest installer from [Releases](https://github.com/bruno00o/gameroute/releases/latest)
2. Run `GameRoute_x.x.x_x64-setup.exe` — the installer requires admin privileges to set up the network capture service
3. Launch GameRoute

### First launch

1. Go to **Games** and click **Scan All** to detect your installed games
2. Click **Start** in the monitoring widget (sidebar)
3. Play a game — GameRoute will automatically capture connections and run route tests
4. Check **Sessions** to see the results

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, TanStack Router/Query/Table, Zustand, Recharts, MapLibre GL |
| Backend | Rust, Tauri v2 |
| Database | SQLite (SQLx) |
| UI | shadcn/ui (Base UI), Tailwind CSS v4, Remix Icon |
| i18n | Inlang Paraglide |
| Installer | NSIS (via Tauri bundler) |

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [pnpm](https://pnpm.io/) 12+
- [Rust](https://rustup.rs/) (stable)
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with "Desktop development with C++"

### Setup

```bash
git clone https://github.com/bruno00o/gameroute.git
cd gameroute
pnpm install
```

### GeoLite2 databases

GameRoute resolves ASN and geolocation data offline using [MaxMind GeoLite2](https://www.maxmind.com/en/geolite2/signup). Before you can run `pnpm tauri dev` or `pnpm tauri build`, download the databases once:

```powershell
# Sign up for a free license key at https://www.maxmind.com/en/geolite2/signup
$env:MAXMIND_LICENSE_KEY = "your-license-key"
pwsh scripts/download-geolite.ps1
```

The `.mmdb` files land in `src-tauri/resources/` and are gitignored.

### Run

```bash
# Full app (frontend + backend with hot reload)
pnpm tauri dev

# Frontend only (no Rust backend)
pnpm dev
```

### Build

```bash
pnpm tauri build
```

### Test & Lint

```bash
pnpm test          # Vitest
pnpm lint          # ESLint

# Rust (from src-tauri/)
cargo test --all-targets
cargo clippy -- -D warnings
```

## Architecture

```
src/                    # React frontend
├── routes/             # File-based routing (TanStack Router)
├── components/         # UI components (shadcn/ui)
├── stores/             # Zustand state stores
├── hooks/              # React hooks (events, health check)
├── lib/                # Utilities (IPC, format, export)
└── types/              # TypeScript types matching Rust structs

src-tauri/              # Rust backend
├── src/
│   ├── commands/       # Tauri IPC handlers
│   ├── services/       # Business logic (traceroute, capture, ASN)
│   ├── db/             # SQLx repositories (SQLite)
│   ├── models/         # Shared data structures
│   └── platform/       # OS-specific code (Windows)
├── migrations/         # SQLite migrations
└── bin/                # Capture service binary
```

## Privacy

GameRoute does not collect any personal data. All session data, game library, and network analysis are stored locally in a SQLite database. ASN and geolocation lookups are performed entirely offline using the bundled GeoLite2 database. The only outbound connections are update checks (GitHub), game artwork (Steam CDN) and map tiles (CARTO). During a match, GameRoute also sends about two small probes per second: one to the last router of your ISP on the route and one to a public measurement point of the game region (AWS, Valve or Epic), which sees your public IP address. Both can be turned off in Settings.

## Attributions

This product includes GeoLite2 Data created by MaxMind, available from [https://www.maxmind.com](https://www.maxmind.com). GeoLite2 is licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

## License

[GPL-3.0](LICENSE)
