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

// Fetch all monitors with pagination
const fetchAllMonitors = async () => {
  const allMonitors = [];
  let currentPage = 1;
  let hasMorePages = true;

  while (hasMorePages) {
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
    allMonitors.push(...data.data);

    if (data.pagination && data.pagination.next) {
      currentPage++;
    } else {
      hasMorePages = false;
    }
  }

  return allMonitors;
};

// Fetch incidents
const fetchIncidents = async () => {
  const allIncidents = [];
  let currentPage = 1;
  let hasMorePages = true;

  while (hasMorePages) {
    const response = await fetch(`${BETTERSTACK_API_URL}/incidents?page=${currentPage}&per_page=50`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${BETTERSTACK_API_TOKEN}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch incidents: ${response.statusText}`);
    }

    const data = await response.json();
    allIncidents.push(...data.data);

    if (data.pagination && data.pagination.next) {
      currentPage++;
    } else {
      hasMorePages = false;
    }
  }

  return allIncidents;
};

// Fetch monitor groups
const fetchMonitorGroups = async () => {
  const response = await fetch(`${BETTERSTACK_API_URL}/monitor-groups`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${BETTERSTACK_API_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch monitor groups: ${response.statusText}`);
  }

  const data = await response.json();
  return data.data || [];
};

// Fetch heartbeats
const fetchHeartbeats = async () => {
  const response = await fetch(`${BETTERSTACK_API_URL}/heartbeats`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${BETTERSTACK_API_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch heartbeats: ${response.statusText}`);
  }

  const data = await response.json();
  return data.data || [];
};

// API Routes
app.get("/api/monitors", async (req, res) => {
  try {
    const monitors = await fetchAllMonitors();
    res.json({ success: true, data: monitors, count: monitors.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/incidents", async (req, res) => {
  try {
    const incidents = await fetchIncidents();
    res.json({ success: true, data: incidents, count: incidents.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/monitor-groups", async (req, res) => {
  try {
    const groups = await fetchMonitorGroups();
    res.json({ success: true, data: groups, count: groups.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/heartbeats", async (req, res) => {
  try {
    const heartbeats = await fetchHeartbeats();
    res.json({ success: true, data: heartbeats, count: heartbeats.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all data at once
app.get("/api/dashboard", async (req, res) => {
  try {
    const [monitors, incidents, groups, heartbeats] = await Promise.all([
      fetchAllMonitors(),
      fetchIncidents().catch(() => []),
      fetchMonitorGroups().catch(() => []),
      fetchHeartbeats().catch(() => []),
    ]);

    // Categorize monitors
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

    // Calculate stats
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

    res.json({
      success: true,
      stats,
      monitors,
      categorized,
      incidents: incidents.slice(0, 50), // Last 50 incidents
      groups,
      heartbeats,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Serve frontend
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`🚀 BetterStack Dashboard running at http://localhost:${PORT}`);
});

