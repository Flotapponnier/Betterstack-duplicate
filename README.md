# BetterStack Dashboard

A self-hosted dashboard to monitor all your BetterStack monitors in one place. Fast, lightweight, and secure.

![Dashboard Preview](https://img.shields.io/badge/status-live-brightgreen)

## Features

- **Secure authentication** - Login required with username/password
- **Real-time monitoring** - View all your monitors status at a glance
- **Heatmap tracking** - 30-day uptime history (built from our own tracking)
- **Incidents feed** - Status changes and incidents with full details
- **Progressive loading** - Data loads batch by batch, no timeout issues
- **Search & Filter** - Find monitors by name, URL or status
- **Responsive** - Works on desktop and mobile
- **Auto-categorization** - Automatically groups monitors by environment (Production/Staging)
- **Auto-refresh** - Data refreshes every 5 minutes automatically
- **SQLite persistence** - Data persists across restarts

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/Flotapponnier/Betterstack-duplicate.git
cd Betterstack-duplicate
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

Create a `.env` file in the root directory:

```env
# Required: Your BetterStack API Token
BETTERSTACK_API_TOKEN=your_token_here

# Required: Authentication credentials
AUTH_USERNAME=admin
AUTH_PASSWORD=your_secure_password

# Required for production: Session secret (random string)
SESSION_SECRET=your_random_secret_string

# Optional: Server port (default: 3000)
PORT=3000
```

### 4. Run the dashboard

```bash
npm start
```

Open http://localhost:3000 and login with your credentials.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BETTERSTACK_API_TOKEN` | Yes | - | Your BetterStack API token |
| `BETTERSTACK_TEAM_ID` | No | - | Your BetterStack team ID (from URL) |
| `AUTH_USERNAME` | Yes | admin | Login username |
| `AUTH_PASSWORD` | Yes | admin | Login password |
| `SESSION_SECRET` | Yes (prod) | - | Secret for session encryption |
| `PRODUCTION_URL_PATTERNS` | No | - | Comma-separated URL patterns for Production category |
| `STAGING_URL_PATTERNS` | No | - | Comma-separated URL patterns for Staging category |
| `PORT` | No | 3000 | Server port |
| `NODE_ENV` | No | - | Set to `production` for production |

## Deploy on Railway

### One-click deploy

1. Fork this repository
2. Go to [Railway](https://railway.app)
3. Create a new project → Deploy from GitHub repo
4. Select your forked repository
5. Add environment variables:
   - `BETTERSTACK_API_TOKEN`
   - `AUTH_USERNAME`
   - `AUTH_PASSWORD`
   - `SESSION_SECRET`
6. Deploy!

Railway will automatically:
- Detect Node.js
- Install dependencies
- Start the server
- Provide a public URL

### Important notes for Railway

- SQLite database is persisted in the project volume
- Auto-refresh runs every 5 minutes to update heatmap data
- The dashboard is protected by login - share credentials with your team

## Deploy with Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

Build and run:

```bash
docker build -t betterstack-dashboard .
docker run -d -p 3000:3000 \
  -e BETTERSTACK_API_TOKEN=your_token \
  -e AUTH_USERNAME=admin \
  -e AUTH_PASSWORD=your_password \
  -e SESSION_SECRET=your_secret \
  -v betterstack-data:/app \
  betterstack-dashboard
```

## API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/login` | GET | No | Login page |
| `/api/login` | POST | No | Authenticate user |
| `/api/logout` | POST | No | Logout user |
| `/api/auth/status` | GET | No | Check auth status |
| `/api/dashboard` | GET | Yes | Get monitors, stats, incidents |
| `/api/feed` | GET | Yes | Get status changes feed |
| `/api/heatmap` | GET | Yes | Get 30-day heatmap data |
| `/api/status` | GET | Yes | Get loading status |
| `/api/refresh` | POST | Yes | Force refresh data |

## How Heatmap Works

The heatmap tracks uptime history by recording monitor status every 5 minutes:

1. **Auto-refresh** runs every 5 minutes
2. Each monitor's current status is recorded in SQLite
3. Daily stats are aggregated: `checks_total`, `checks_failed`
4. Heatmap shows 30 days of history with color coding:
   - Green: 0% failures
   - Yellow: 1-49% failures (partial outage)
   - Red: 50%+ failures
   - Gray: No data (before tracking started)

## Tech Stack

- **Backend**: Node.js, Express, express-session
- **Database**: SQLite (better-sqlite3)
- **Frontend**: Vanilla JS, CSS
- **Fonts**: JetBrains Mono, Outfit

## Security

- Passwords are compared in constant-time (session-based auth)
- Sessions expire after 24 hours
- All API endpoints (except auth) require authentication
- Session cookies are HTTP-only

## License

MIT License - feel free to use and modify!

## Contributing

PRs welcome! Feel free to open issues or submit pull requests.
