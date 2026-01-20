# BetterStack Dashboard

A self-hosted monitoring dashboard for BetterStack. View all your monitors, incidents, SLA reports, and response times in one place.

## Features

- **Authentication** - Secure login with username/password
- **Real-time monitoring** - View all monitors status at a glance
- **Heatmap** - 30-day uptime history tracked locally
- **Incidents** - Full incident details with response content
- **SLA Reports** - Availability percentage, downtime, incident stats
- **Response Times** - Average response times per monitor
- **Heartbeats** - Monitor your cron jobs and scheduled tasks
- **Search & Filter** - Find monitors by name, URL, or status
- **Auto-categorization** - Group monitors by Production/Staging
- **Auto-refresh** - Data updates every 5 minutes
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

Copy the example file and edit it:

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
BETTERSTACK_API_TOKEN=your_token_here
AUTH_USERNAME=admin
AUTH_PASSWORD=your_secure_password
SESSION_SECRET=random_string_here
```

### 4. Run

```bash
npm start
```

Open http://localhost:3000 and login.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BETTERSTACK_API_TOKEN` | Yes | Your BetterStack API token |
| `AUTH_USERNAME` | Yes | Login username |
| `AUTH_PASSWORD` | Yes | Login password |
| `SESSION_SECRET` | Yes | Secret for session encryption |
| `BETTERSTACK_TEAM_ID` | No | Team ID for direct BetterStack links |
| `PRODUCTION_URL_PATTERNS` | No | Comma-separated URL patterns for Production category |
| `STAGING_URL_PATTERNS` | No | Comma-separated URL patterns for Staging category |
| `PORT` | No | Server port (default: 3000) |

### Getting your BetterStack API Token

1. Go to https://uptime.betterstack.com/team/settings/api-tokens
2. Create a new token with read permissions
3. Copy the token to your `.env` file

### URL Patterns for Categorization

If you want to categorize monitors into Production/Staging:

```env
PRODUCTION_URL_PATTERNS=api.myapp.com,prod.myapp.com
STAGING_URL_PATTERNS=staging.myapp.com,dev.myapp.com
```

Monitors matching these patterns will be grouped accordingly.

## Deploy on Railway

1. Fork this repository
2. Go to [Railway](https://railway.app)
3. Create new project > Deploy from GitHub
4. Select your fork
5. Add environment variables in Railway settings
6. Deploy

Railway auto-detects Node.js and provides a public URL.

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

## How It Works

### Heatmap Tracking

The dashboard tracks monitor status every 5 minutes and stores it in SQLite. This builds a 30-day history showing:

- Green: No failures
- Yellow: Partial failures (1-49%)
- Red: Major failures (50%+)
- Gray: No data yet

### Data Flow

1. On startup, loads cached data from SQLite
2. Fetches fresh data from BetterStack API in background
3. Auto-refreshes every 5 minutes
4. Saves all data to SQLite for persistence

## Tech Stack

- Node.js / Express
- SQLite (better-sqlite3)
- Vanilla JavaScript / CSS

## License

MIT
