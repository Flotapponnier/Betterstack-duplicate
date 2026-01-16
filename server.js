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
    const response = await fetch(`${BETTERSTACK_API_URL}/incidents?per_page=50`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${BETTERSTACK_API_TOKEN}`,
      },
    });

    if (!response.ok) {
      console.error("Failed to fetch incidents:", response.statusText);
      return [];
    }

    const data = await response.json();
    console.log(`✅ Fetched ${data.data.length} incidents`);
    return data.data || [];
  } catch (error) {
    console.error("❌ Error fetching incidents:", error.message);
    return [];
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
    
    // Fetch incidents after monitors
    incidents = await fetchIncidents();
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
