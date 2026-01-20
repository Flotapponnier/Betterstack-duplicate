require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const session = require("express-session");
const database = require("./database");

const app = express();
const PORT = process.env.PORT || 3000;

// Auth credentials from environment
const AUTH_USERNAME = process.env.AUTH_USERNAME || "admin";
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || "admin";
const SESSION_SECRET = process.env.SESSION_SECRET || "betterstack-dashboard-secret-change-me";

const BETTERSTACK_API_TOKEN = process.env.BETTERSTACK_API_TOKEN;
const BETTERSTACK_API_URL = "https://uptime.betterstack.com/api/v2";
const BETTERSTACK_TEAM_ID = process.env.BETTERSTACK_TEAM_ID || "";

// URL patterns for categorization (comma-separated)
const PRODUCTION_URL_PATTERNS = process.env.PRODUCTION_URL_PATTERNS 
  ? process.env.PRODUCTION_URL_PATTERNS.split(',').map(p => p.trim().toLowerCase())
  : [];
const STAGING_URL_PATTERNS = process.env.STAGING_URL_PATTERNS
  ? process.env.STAGING_URL_PATTERNS.split(',').map(p => p.trim().toLowerCase())
  : [];

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production' && process.env.HTTPS === 'true',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Auth middleware - check if user is authenticated
const requireAuth = (req, res, next) => {
  if (req.session && req.session.authenticated) {
    return next();
  }
  // For API calls, return 401
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Please login first' });
  }
  // For page requests, redirect to login
  res.redirect('/login');
};

// In-memory cache (loaded from DB on startup)
let monitors = [];
let incidents = [];
let lastUpdated = null;
let isLoading = false;
let loadingProgress = { current: 0, total: 0 };

// Load data from database on startup
const loadFromDatabase = () => {
  if (database.hasData()) {
    monitors = database.getMonitors();
    incidents = database.getIncidents();
    lastUpdated = database.getLastUpdated();
    console.log(`Loaded from database: ${monitors.length} monitors, ${incidents.length} incidents`);
    return true;
  }
  return false;
};

// Build dashboard data from current monitors
const buildDashboardData = () => {
  const categorized = {
    production: [],
    staging: [],
    other: [],
  };

  monitors.forEach((monitor) => {
    const url = monitor.attributes.url?.toLowerCase() || "";
    
    // Check if URL matches any production pattern
    const isProduction = PRODUCTION_URL_PATTERNS.length > 0 && 
      PRODUCTION_URL_PATTERNS.some(pattern => url.includes(pattern));
    
    // Check if URL matches any staging pattern
    const isStaging = STAGING_URL_PATTERNS.length > 0 && 
      STAGING_URL_PATTERNS.some(pattern => url.includes(pattern));
    
    if (isProduction) {
      categorized.production.push(monitor);
    } else if (isStaging) {
      categorized.staging.push(monitor);
    } else {
      categorized.other.push(monitor);
    }
  });

  const stats = {
    total: monitors.length,
    up: monitors.filter((m) => m.attributes.status === "up").length,
    down: monitors.filter((m) => m.attributes.status === "down").length,
    paused: monitors.filter((m) => m.attributes.status === "paused").length,
    validating: monitors.filter((m) => m.attributes.status === "validating").length,
    production: {
      total: categorized.production.length,
      up: categorized.production.filter((m) => m.attributes.status === "up").length,
      down: categorized.production.filter((m) => m.attributes.status === "down").length,
    },
    staging: {
      total: categorized.staging.length,
      up: categorized.staging.filter((m) => m.attributes.status === "up").length,
      down: categorized.staging.filter((m) => m.attributes.status === "down").length,
    },
  };

  return {
    success: true,
    stats,
    monitors,
    categorized,
    incidents,
    isLoading,
    loadingProgress,
    lastUpdated: lastUpdated || new Date().toISOString(),
  };
};

// Fetch incidents with full details
const fetchIncidents = async () => {
  try {
    console.log("Fetching incidents...");
    const allIncidents = [];
    let page = 1;
    
    while (page <= 5) {
      const response = await fetch(`${BETTERSTACK_API_URL}/incidents?per_page=50&page=${page}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${BETTERSTACK_API_TOKEN}`,
        },
      });

      if (!response.ok) {
        console.error("Failed to fetch incidents:", response.statusText);
        break;
      }

      const data = await response.json();
      allIncidents.push(...(data.data || []));
      
      if (!data.pagination?.next) break;
      page++;
    }
    
    console.log(`Fetched ${allIncidents.length} incidents`);
    return allIncidents;
  } catch (error) {
    console.error("Error fetching incidents:", error.message);
    return [];
  }
};


// Fetch monitors page by page, updating cache progressively
const fetchMonitorsProgressively = async () => {
  if (isLoading) return;
  isLoading = true;
  const newMonitors = [];
  loadingProgress = { current: 0, total: 0 };
  
  let currentPage = 1;
  
  try {
    while (true) {
      console.log(`Fetching page ${currentPage}...`);
      
      const response = await fetch(`${BETTERSTACK_API_URL}/monitors?page=${currentPage}&per_page=50`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${BETTERSTACK_API_TOKEN}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch monitors: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Add new monitors to temp array
      newMonitors.push(...data.data);
      loadingProgress.current = newMonitors.length;
      
      // Estimate total from pagination
      if (data.pagination) {
        loadingProgress.total = data.pagination.next ? newMonitors.length + 50 : newMonitors.length;
      }
      
      console.log(`Page ${currentPage}: +${data.data.length} monitors (total: ${newMonitors.length})`);

      if (data.pagination && data.pagination.next) {
        currentPage++;
        await new Promise(r => setTimeout(r, 100));
      } else {
        break;
      }
    }
    
    // Update in-memory cache
    monitors = newMonitors;
    lastUpdated = new Date().toISOString();
    
    // Save to database
    database.saveMonitors(monitors);
    
    // Record daily status for heatmap tracking
    database.recordAllDailyStatus(monitors);
    console.log(`Finished loading ${monitors.length} monitors (saved to DB + daily status recorded)`);
    
    // Fetch incidents and status changes after monitors
    const newIncidents = await fetchIncidents();
    incidents = newIncidents;
    database.saveIncidents(incidents);
    
  } catch (error) {
    console.error("Error fetching monitors:", error.message);
  } finally {
    isLoading = false;
    loadingProgress.total = monitors.length;
  }
};

// ============== AUTH ROUTES ==============

// Login page
app.get("/login", (req, res) => {
  if (req.session && req.session.authenticated) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// Login POST
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  
  if (username === AUTH_USERNAME && password === AUTH_PASSWORD) {
    req.session.authenticated = true;
    req.session.username = username;
    res.json({ success: true, message: 'Login successful' });
  } else {
    res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
});

// Logout
app.post("/api/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Logout failed' });
    }
    res.json({ success: true, message: 'Logged out' });
  });
});

// Check auth status
app.get("/api/auth/status", (req, res) => {
  res.json({ 
    authenticated: !!(req.session && req.session.authenticated),
    username: req.session?.username || null
  });
});

// Get config (team ID for BetterStack links)
app.get("/api/config", requireAuth, (req, res) => {
  res.json({
    betterStackTeamId: BETTERSTACK_TEAM_ID,
  });
});

// ============== PROTECTED ROUTES ==============

// Serve static files (but protect the main app)
app.use(express.static(path.join(__dirname, "public")));

// Dashboard endpoint - triggers refresh in background on each visit
app.get("/api/dashboard", requireAuth, (req, res) => {
  // Return cached data immediately
  res.json(buildDashboardData());
  
  // Trigger background refresh if not already loading
  if (!isLoading) {
    console.log("Visitor triggered background refresh...");
    fetchMonitorsProgressively();
  }
});

app.get("/api/status", requireAuth, (req, res) => {
  res.json({
    monitorsCount: monitors.length,
    isLoading,
    loadingProgress,
    lastUpdated,
  });
});

// Force refresh endpoint
app.post("/api/refresh", requireAuth, (req, res) => {
  if (!isLoading) {
    fetchMonitorsProgressively();
  }
  res.json({ success: true, message: isLoading ? "Already loading" : "Refresh started" });
});


// Proxy endpoint to test monitor URLs with auth headers
app.post("/api/proxy", requireAuth, async (req, res) => {
  const { url, authValue } = req.body;
  
  if (!url) {
    return res.status(400).json({ success: false, error: 'URL is required' });
  }
  
  try {
    const headers = {};
    if (authValue) {
      headers['Authorization'] = authValue;
    }
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout
    
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    
    const contentType = response.headers.get('content-type') || '';
    let body;
    
    if (contentType.includes('application/json')) {
      body = await response.json();
    } else {
      body = await response.text();
    }
    
    res.json({
      success: true,
      status: response.status,
      statusText: response.statusText,
      body,
    });
  } catch (error) {
    res.json({
      success: false,
      error: error.name === 'AbortError' ? 'Request timeout (30s)' : error.message,
    });
  }
});

// ============== NEW ENDPOINTS ==============

// Heartbeats endpoint - cron jobs monitoring
app.get("/api/heartbeats", requireAuth, async (req, res) => {
  try {
    const response = await fetch(`${BETTERSTACK_API_URL}/heartbeats`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${BETTERSTACK_API_TOKEN}`,
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ success: false, error: response.statusText });
    }

    const data = await response.json();
    
    const heartbeats = (data.data || []).map(hb => ({
      id: hb.id,
      name: hb.attributes.name,
      status: hb.attributes.status,
      period: hb.attributes.period,
      grace: hb.attributes.grace,
      paused: hb.attributes.paused,
      url: hb.attributes.url,
      createdAt: hb.attributes.created_at,
      updatedAt: hb.attributes.updated_at,
    }));

    res.json({ success: true, data: heartbeats, count: heartbeats.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// SLA endpoint - get uptime stats for a specific monitor
app.get("/api/sla/:monitorId", requireAuth, async (req, res) => {
  try {
    const { monitorId } = req.params;
    const { from, to } = req.query;
    
    // Default to last 30 days
    const toDate = to || new Date().toISOString().split('T')[0];
    const fromDate = from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const response = await fetch(
      `${BETTERSTACK_API_URL}/monitors/${monitorId}/sla?from=${fromDate}&to=${toDate}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${BETTERSTACK_API_TOKEN}`,
        },
      }
    );

    if (!response.ok) {
      return res.status(response.status).json({ success: false, error: response.statusText });
    }

    const data = await response.json();
    
    res.json({
      success: true,
      data: {
        monitorId: data.data.id,
        availability: data.data.attributes.availability,
        totalDowntime: data.data.attributes.total_downtime,
        numberOfIncidents: data.data.attributes.number_of_incidents,
        longestIncident: data.data.attributes.longest_incident,
        averageIncident: data.data.attributes.average_incident,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Batch SLA endpoint - get uptime stats for all monitors
app.get("/api/sla", requireAuth, async (req, res) => {
  try {
    const { from, to } = req.query;
    
    // Default to last 30 days
    const toDate = to || new Date().toISOString().split('T')[0];
    const fromDate = from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    // Fetch SLA for all monitors (in batches to avoid rate limiting)
    const slaData = [];
    
    for (const monitor of monitors) {
      try {
        const response = await fetch(
          `${BETTERSTACK_API_URL}/monitors/${monitor.id}/sla?from=${fromDate}&to=${toDate}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${BETTERSTACK_API_TOKEN}`,
            },
          }
        );

        if (response.ok) {
          const data = await response.json();
          slaData.push({
            monitorId: monitor.id,
            monitorName: monitor.attributes?.pronounceable_name || monitor.attributes?.url,
            monitorUrl: monitor.attributes?.url,
            status: monitor.attributes?.status,
            availability: data.data.attributes.availability,
            totalDowntime: data.data.attributes.total_downtime,
            numberOfIncidents: data.data.attributes.number_of_incidents,
            longestIncident: data.data.attributes.longest_incident,
            averageIncident: data.data.attributes.average_incident,
          });
        }
        
        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 50));
      } catch (err) {
        // Skip failed monitors
      }
    }
    
    // Sort by availability (lowest first)
    slaData.sort((a, b) => a.availability - b.availability);
    
    res.json({ success: true, data: slaData, count: slaData.length, period: { from: fromDate, to: toDate } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Response times endpoint - get response times for a monitor
app.get("/api/response-times/:monitorId", requireAuth, async (req, res) => {
  try {
    const { monitorId } = req.params;
    const { from, to } = req.query;
    
    // Default to last 24 hours
    const toDate = to || new Date().toISOString().split('T')[0];
    const fromDate = from || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const response = await fetch(
      `${BETTERSTACK_API_URL}/monitors/${monitorId}/response-times?from=${fromDate}&to=${toDate}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${BETTERSTACK_API_TOKEN}`,
        },
      }
    );

    if (!response.ok) {
      return res.status(response.status).json({ success: false, error: response.statusText });
    }

    const data = await response.json();
    
    res.json({
      success: true,
      data: data.data.attributes.regions,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Incident details with response content
app.get("/api/incidents/:incidentId", requireAuth, async (req, res) => {
  try {
    const { incidentId } = req.params;
    
    // Find incident in cache
    const incident = incidents.find(i => i.id === incidentId);
    
    if (!incident) {
      return res.status(404).json({ success: false, error: 'Incident not found' });
    }
    
    const monitor = monitors.find(m => m.id === incident.relationships?.monitor?.data?.id);
    
    // Parse response options if available
    let responseOptions = null;
    if (incident.attributes?.response_options) {
      try {
        responseOptions = JSON.parse(incident.attributes.response_options);
      } catch (e) {
        responseOptions = incident.attributes.response_options;
      }
    }
    
    res.json({
      success: true,
      data: {
      id: incident.id,
        name: incident.attributes?.name,
      status: incident.attributes?.status,
      cause: incident.attributes?.cause,
        url: incident.attributes?.url,
        httpMethod: incident.attributes?.http_method,
        startedAt: incident.attributes?.started_at,
      resolvedAt: incident.attributes?.resolved_at,
        acknowledgedAt: incident.attributes?.acknowledged_at,
        acknowledgedBy: incident.attributes?.acknowledged_by,
        resolvedBy: incident.attributes?.resolved_by,
        responseContent: incident.attributes?.response_content,
        responseOptions,
        responseUrl: incident.attributes?.response_url,
        screenshotUrl: incident.attributes?.screenshot_url,
        metadata: incident.attributes?.metadata,
        regions: incident.attributes?.regions,
        monitor: {
          id: monitor?.id,
          name: monitor?.attributes?.pronounceable_name,
          url: monitor?.attributes?.url,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Heatmap data endpoint - uses our own tracking from daily_status table
app.get("/api/heatmap", requireAuth, (req, res) => {
  const now = new Date();
  
  // Get tracked daily status from database
  const dailyStatusByMonitor = database.getDailyStatusForHeatmap(30);
  
  // Build heatmap data for each monitor
  const heatmapData = {};
  
  monitors.forEach(monitor => {
    // Generate last 30 days
    const days = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split('T')[0];
      
      // Check if we have tracked data for this day
      const trackedDays = dailyStatusByMonitor[monitor.id] || [];
      const trackedDay = trackedDays.find(d => d.date === dateStr);
      
      if (trackedDay) {
        // We have real data from our tracking
        const failRate = trackedDay.checksTotal > 0 
          ? trackedDay.checksFailed / trackedDay.checksTotal 
          : 0;
        
        let status = 'up';
        if (failRate >= 0.5) {
          status = 'down'; // More than 50% checks failed
        } else if (failRate > 0) {
          status = 'partial'; // Some checks failed
        }
        
        days.push({
          date: dateStr,
          status,
          downtime: trackedDay.downtimeMinutes,
          checksTotal: trackedDay.checksTotal,
          checksFailed: trackedDay.checksFailed,
          failRate: Math.round(failRate * 100),
        });
      } else {
        // No data for this day (before we started tracking)
      days.push({
          date: dateStr,
          status: 'unknown',
        downtime: 0,
          checksTotal: 0,
          checksFailed: 0,
          failRate: 0,
      });
      }
    }
    
    heatmapData[monitor.id] = {
      id: monitor.id,
      name: monitor.attributes?.pronounceable_name || monitor.attributes?.url,
      url: monitor.attributes?.url,
      currentStatus: monitor.attributes?.status,
      days,
    };
  });
  
  // Convert to array and sort by current status (down first) then by name
  const heatmapArray = Object.values(heatmapData)
    .sort((a, b) => {
      if (a.currentStatus === 'down' && b.currentStatus !== 'down') return -1;
      if (a.currentStatus !== 'down' && b.currentStatus === 'down') return 1;
      return a.name.localeCompare(b.name);
    });
  
  res.json({ success: true, data: heatmapArray, count: heatmapArray.length });
});

// Serve frontend (protected)
app.get("/", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  database.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down...');
  database.close();
  process.exit(0);
});

// Auto-refresh interval (5 minutes)
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const startAutoRefresh = () => {
  setInterval(() => {
    if (!isLoading) {
      console.log("Auto-refresh triggered (every 5 min)...");
      fetchMonitorsProgressively();
    }
  }, REFRESH_INTERVAL_MS);
  console.log(`Auto-refresh enabled: every ${REFRESH_INTERVAL_MS / 1000 / 60} minutes`);
};

// Start server
app.listen(PORT, () => {
  console.log(`BetterStack Dashboard running at http://localhost:${PORT}`);
  console.log(`Auth enabled - Username: ${AUTH_USERNAME}`);
  
  // Load from database first
  const hasData = loadFromDatabase();
  
  if (hasData) {
    console.log("Data loaded from database - ready to serve!");
    // Still trigger a background refresh to get latest data
    console.log("Starting background refresh for latest data...");
    fetchMonitorsProgressively();
  } else {
    console.log("No data in database - starting initial load...");
  fetchMonitorsProgressively();
  }
  
  // Start auto-refresh
  startAutoRefresh();
});
