require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const BETTERSTACK_API_TOKEN = process.env.BETTERSTACK_API_TOKEN;
const BETTERSTACK_API_URL = "https://uptime.betterstack.com/api/v2";

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Cache for monitors data - loads progressively
let monitors = [];
let incidents = [];
let statusChanges = []; // Feed of status changes
let lastUpdated = null;
let isLoading = false;
let loadingProgress = { current: 0, total: 0 };

// Build dashboard data from current monitors
const buildDashboardData = () => {
  const categorized = {
    production: [],
    staging: [],
    other: [],
  };

  monitors.forEach((monitor) => {
    const url = monitor.attributes.url?.toLowerCase() || "";
    if (url.includes("api-2.mobula.io") || url.includes("explorer-api-2.mobula.io")) {
      categorized.production.push(monitor);
    } else if (
      url.includes("api.mobula.io") ||
      url.includes("api.zobula.xyz") ||
      url.includes("explorer-api.mobula.io") ||
      url.includes("explorer-api.zobula.xyz")
    ) {
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

// Fetch incidents
const fetchIncidents = async () => {
  try {
    console.log("📋 Fetching incidents...");
    const allIncidents = [];
    let page = 1;
    
    while (page <= 5) { // Max 5 pages
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
    
    console.log(`✅ Fetched ${allIncidents.length} incidents`);
    return allIncidents;
  } catch (error) {
    console.error("❌ Error fetching incidents:", error.message);
    return [];
  }
};

// Fetch status changes for feed
const fetchStatusChanges = async () => {
  try {
    console.log("📰 Fetching status changes...");
    const allChanges = [];
    let page = 1;
    
    while (page <= 3) { // Max 3 pages
      const response = await fetch(`${BETTERSTACK_API_URL}/status-changes?per_page=100&page=${page}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${BETTERSTACK_API_TOKEN}`,
        },
      });

      if (!response.ok) {
        console.error("Failed to fetch status changes:", response.statusText);
        break;
      }

      const data = await response.json();
      allChanges.push(...(data.data || []));
      
      if (!data.pagination?.next) break;
      page++;
    }
    
    console.log(`✅ Fetched ${allChanges.length} status changes`);
    return allChanges;
  } catch (error) {
    console.error("❌ Error fetching status changes:", error.message);
    return [];
  }
};

// Fetch monitor SLA (uptime percentage over time)
const fetchMonitorSLA = async (monitorId) => {
  try {
    const response = await fetch(`${BETTERSTACK_API_URL}/monitors/${monitorId}/sla`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${BETTERSTACK_API_TOKEN}`,
      },
    });

    if (!response.ok) return null;
    const data = await response.json();
    return data.data;
  } catch (error) {
    return null;
  }
};

// Fetch monitors page by page, updating cache progressively
const fetchMonitorsProgressively = async () => {
  if (isLoading) return;
  isLoading = true;
  monitors = []; // Reset
  loadingProgress = { current: 0, total: 0 };
  
  let currentPage = 1;
  
  try {
    while (true) {
      console.log(`📦 Fetching page ${currentPage}...`);
      
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
      
      // Add new monitors to cache immediately
      monitors.push(...data.data);
      loadingProgress.current = monitors.length;
      
      // Estimate total from pagination
      if (data.pagination) {
        // BetterStack doesn't give total, estimate from pages
        loadingProgress.total = data.pagination.next ? monitors.length + 50 : monitors.length;
      }
      
      console.log(`✅ Page ${currentPage}: +${data.data.length} monitors (total: ${monitors.length})`);
      lastUpdated = new Date().toISOString();

      if (data.pagination && data.pagination.next) {
        currentPage++;
        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 100));
      } else {
        break;
      }
    }
    
    console.log(`🎉 Finished loading ${monitors.length} monitors`);
    
    // Fetch incidents and status changes after monitors
    incidents = await fetchIncidents();
    statusChanges = await fetchStatusChanges();
  } catch (error) {
    console.error("❌ Error fetching monitors:", error.message);
  } finally {
    isLoading = false;
    loadingProgress.total = monitors.length;
  }
};

// API Routes
app.get("/api/dashboard", (req, res) => {
  res.json(buildDashboardData());
});

app.get("/api/status", (req, res) => {
  res.json({
    monitorsCount: monitors.length,
    isLoading,
    loadingProgress,
    lastUpdated,
  });
});

// Force refresh endpoint
app.post("/api/refresh", (req, res) => {
  if (!isLoading) {
    fetchMonitorsProgressively();
  }
  res.json({ success: true, message: isLoading ? "Already loading" : "Refresh started" });
});

// Feed endpoint - status changes and incidents combined
app.get("/api/feed", (req, res) => {
  // Combine status changes and incidents into a unified feed
  const feed = [];
  
  // Add status changes
  statusChanges.forEach(change => {
    const monitor = monitors.find(m => m.id === change.relationships?.monitor?.data?.id);
    feed.push({
      type: 'status_change',
      id: change.id,
      timestamp: change.attributes?.started_at || change.attributes?.created_at,
      status: change.attributes?.status,
      monitorId: change.relationships?.monitor?.data?.id,
      monitorName: monitor?.attributes?.pronounceable_name || 'Unknown',
      monitorUrl: monitor?.attributes?.url || '',
    });
  });
  
  // Add incidents
  incidents.forEach(incident => {
    feed.push({
      type: 'incident',
      id: incident.id,
      timestamp: incident.attributes?.started_at,
      status: incident.attributes?.status,
      name: incident.attributes?.name,
      cause: incident.attributes?.cause,
      resolvedAt: incident.attributes?.resolved_at,
    });
  });
  
  // Sort by timestamp descending
  feed.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  
  res.json({ success: true, data: feed.slice(0, 200), count: feed.length });
});

// Heatmap data endpoint - uptime for last 30 days
app.get("/api/heatmap", async (req, res) => {
  // Build heatmap from incidents and status changes
  const heatmapData = {};
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  
  // Initialize all monitors with 30 days of "up" status
  monitors.forEach(monitor => {
    const days = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      days.push({
        date: date.toISOString().split('T')[0],
        status: 'up',
        downtime: 0,
      });
    }
    heatmapData[monitor.id] = {
      id: monitor.id,
      name: monitor.attributes?.pronounceable_name || monitor.attributes?.url,
      url: monitor.attributes?.url,
      currentStatus: monitor.attributes?.status,
      days,
    };
  });
  
  // Mark days with incidents as down
  incidents.forEach(incident => {
    const monitorId = incident.relationships?.monitor?.data?.id;
    if (!monitorId || !heatmapData[monitorId]) return;
    
    const startDate = new Date(incident.attributes?.started_at);
    const endDate = incident.attributes?.resolved_at 
      ? new Date(incident.attributes.resolved_at) 
      : now;
    
    if (startDate < thirtyDaysAgo) return;
    
    heatmapData[monitorId].days.forEach(day => {
      const dayDate = new Date(day.date);
      const dayEnd = new Date(dayDate.getTime() + 24 * 60 * 60 * 1000);
      
      // Check if incident overlaps with this day
      if (startDate < dayEnd && endDate > dayDate) {
        day.status = 'down';
        // Calculate downtime in minutes for this day
        const overlapStart = Math.max(startDate.getTime(), dayDate.getTime());
        const overlapEnd = Math.min(endDate.getTime(), dayEnd.getTime());
        day.downtime += Math.round((overlapEnd - overlapStart) / (1000 * 60));
      }
    });
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

// Serve frontend
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Start server and preload cache
app.listen(PORT, () => {
  console.log(`🚀 BetterStack Dashboard running at http://localhost:${PORT}`);
  console.log("📦 Starting progressive load...");
  fetchMonitorsProgressively();
});
