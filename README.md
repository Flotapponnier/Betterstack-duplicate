# BetterStack Duplicate

A self-hosted dashboard to monitor all your BetterStack monitors in one place. Fast, lightweight, and easy to deploy.

![Dashboard Preview](https://img.shields.io/badge/status-live-brightgreen)

## Features

- 📊 **Real-time monitoring** - View all your monitors status at a glance
- 🚀 **Progressive loading** - Data loads batch by batch, no timeout issues
- 🔍 **Search & Filter** - Find monitors by name, URL or status
- 📱 **Responsive** - Works on desktop and mobile
- 🏷️ **Auto-categorization** - Automatically groups monitors by environment (Production/Staging)
- 📋 **Incidents tracking** - View recent incidents
- 🔄 **Auto-refresh** - Dashboard updates automatically

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
# Get it from: https://uptime.betterstack.com/team/settings/api-tokens
BETTERSTACK_API_TOKEN=your_token_here

# Optional: Server port (default: 3000)
PORT=3000
```

### 4. Run the dashboard

```bash
npm start
```

Open http://localhost:3000 in your browser.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BETTERSTACK_API_TOKEN` | Yes | - | Your BetterStack API token |
| `PORT` | No | 3000 | Server port |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/dashboard` | GET | Get all monitors, stats, and incidents |
| `/api/status` | GET | Get loading status and cache info |
| `/api/refresh` | POST | Force refresh the cache |

## Customization

### Monitor Categories

By default, monitors are categorized based on URL patterns. Edit `server.js` to customize:

```javascript
// In buildDashboardData() function
if (url.includes("api-2.mobula.io")) {
  categorized.production.push(monitor);
} else if (url.includes("api.mobula.io")) {
  categorized.staging.push(monitor);
}
```

## Deployment

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

### Railway / Render / Heroku

1. Connect your GitHub repository
2. Set the `BETTERSTACK_API_TOKEN` environment variable
3. Deploy!

## Tech Stack

- **Backend**: Node.js, Express
- **Frontend**: Vanilla JS, CSS
- **Fonts**: JetBrains Mono, Outfit

## License

MIT License - feel free to use and modify!

## Contributing

PRs welcome! Feel free to open issues or submit pull requests.
