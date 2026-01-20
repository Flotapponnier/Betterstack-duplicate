const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "betterstack.db"));

// Enable WAL mode for better performance
db.pragma("journal_mode = WAL");

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS monitors (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS incidents (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS status_changes (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- New table for heatmap: tracks daily status per monitor
  CREATE TABLE IF NOT EXISTS daily_status (
    monitor_id TEXT NOT NULL,
    date TEXT NOT NULL,
    status TEXT NOT NULL,
    downtime_minutes INTEGER DEFAULT 0,
    checks_total INTEGER DEFAULT 0,
    checks_failed INTEGER DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (monitor_id, date)
  );

  -- Index for faster queries
  CREATE INDEX IF NOT EXISTS idx_daily_status_date ON daily_status(date);
`);

// Prepared statements for better performance
const stmts = {
  upsertMonitor: db.prepare(`
    INSERT OR REPLACE INTO monitors (id, data, updated_at)
    VALUES (?, ?, ?)
  `),
  upsertIncident: db.prepare(`
    INSERT OR REPLACE INTO incidents (id, data, updated_at)
    VALUES (?, ?, ?)
  `),
  upsertStatusChange: db.prepare(`
    INSERT OR REPLACE INTO status_changes (id, data, updated_at)
    VALUES (?, ?, ?)
  `),
  getAllMonitors: db.prepare(`SELECT data FROM monitors`),
  getAllIncidents: db.prepare(`SELECT data FROM incidents`),
  getAllStatusChanges: db.prepare(`SELECT data FROM status_changes`),
  clearMonitors: db.prepare(`DELETE FROM monitors`),
  clearIncidents: db.prepare(`DELETE FROM incidents`),
  clearStatusChanges: db.prepare(`DELETE FROM status_changes`),
  getMetadata: db.prepare(`SELECT value FROM metadata WHERE key = ?`),
  setMetadata: db.prepare(`INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)`),
  
  // Daily status statements
  upsertDailyStatus: db.prepare(`
    INSERT INTO daily_status (monitor_id, date, status, downtime_minutes, checks_total, checks_failed, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(monitor_id, date) DO UPDATE SET
      status = CASE 
        WHEN excluded.status = 'down' THEN 'down'
        WHEN daily_status.status = 'down' THEN 'down'
        ELSE excluded.status
      END,
      downtime_minutes = daily_status.downtime_minutes + excluded.downtime_minutes,
      checks_total = daily_status.checks_total + excluded.checks_total,
      checks_failed = daily_status.checks_failed + excluded.checks_failed,
      updated_at = excluded.updated_at
  `),
  getDailyStatusForMonitor: db.prepare(`
    SELECT * FROM daily_status 
    WHERE monitor_id = ? AND date >= ?
    ORDER BY date ASC
  `),
  getAllDailyStatus: db.prepare(`
    SELECT * FROM daily_status 
    WHERE date >= ?
    ORDER BY monitor_id, date ASC
  `),
  getLatestDailyStatusDate: db.prepare(`
    SELECT MAX(date) as max_date FROM daily_status WHERE monitor_id = ?
  `),
  setDailyStatusDirect: db.prepare(`
    INSERT OR REPLACE INTO daily_status (monitor_id, date, status, downtime_minutes, checks_total, checks_failed, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
};

// Database operations
const database = {
  // Save monitors (batch insert for performance)
  saveMonitors: (monitors) => {
    const now = new Date().toISOString();
    const insertMany = db.transaction((items) => {
      for (const monitor of items) {
        stmts.upsertMonitor.run(monitor.id, JSON.stringify(monitor), now);
      }
    });
    insertMany(monitors);
    stmts.setMetadata.run("lastUpdated", now);
  },

  // Save incidents
  saveIncidents: (incidents) => {
    const now = new Date().toISOString();
    const insertMany = db.transaction((items) => {
      stmts.clearIncidents.run();
      for (const incident of items) {
        stmts.upsertIncident.run(incident.id, JSON.stringify(incident), now);
      }
    });
    insertMany(incidents);
  },

  // Save status changes
  saveStatusChanges: (changes) => {
    const now = new Date().toISOString();
    const insertMany = db.transaction((items) => {
      stmts.clearStatusChanges.run();
      for (const change of items) {
        stmts.upsertStatusChange.run(change.id, JSON.stringify(change), now);
      }
    });
    insertMany(changes);
  },

  // Get all monitors
  getMonitors: () => {
    const rows = stmts.getAllMonitors.all();
    return rows.map((row) => JSON.parse(row.data));
  },

  // Get all incidents
  getIncidents: () => {
    const rows = stmts.getAllIncidents.all();
    return rows.map((row) => JSON.parse(row.data));
  },

  // Get all status changes
  getStatusChanges: () => {
    const rows = stmts.getAllStatusChanges.all();
    return rows.map((row) => JSON.parse(row.data));
  },

  // Get last updated timestamp
  getLastUpdated: () => {
    const row = stmts.getMetadata.get("lastUpdated");
    return row ? row.value : null;
  },

  // Check if database has data
  hasData: () => {
    const monitors = stmts.getAllMonitors.all();
    return monitors.length > 0;
  },

  // Clear all data
  clearAll: () => {
    db.transaction(() => {
      stmts.clearMonitors.run();
      stmts.clearIncidents.run();
      stmts.clearStatusChanges.run();
    })();
  },

  // Record daily status for a monitor (called on each refresh)
  recordDailyStatus: (monitorId, status, isDown) => {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const updatedAt = now.toISOString();
    
    // Each check counts as 1, if down we add downtime based on check frequency (assume ~1 min per check)
    const downtimeToAdd = isDown ? 1 : 0;
    
    stmts.upsertDailyStatus.run(
      monitorId,
      today,
      status,
      downtimeToAdd,
      1, // checks_total
      isDown ? 1 : 0, // checks_failed
      updatedAt
    );
  },

  // Record daily status for all monitors at once (batch)
  recordAllDailyStatus: (monitors) => {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const updatedAt = now.toISOString();
    
    const insertMany = db.transaction((items) => {
      for (const monitor of items) {
        const status = monitor.attributes?.status || 'unknown';
        const isDown = status === 'down';
        const downtimeToAdd = isDown ? 1 : 0;
        
        stmts.upsertDailyStatus.run(
          monitor.id,
          today,
          status,
          downtimeToAdd,
          1,
          isDown ? 1 : 0,
          updatedAt
        );
      }
    });
    insertMany(monitors);
  },

  // Get daily status for heatmap (last N days)
  getDailyStatusForHeatmap: (days = 30) => {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];
    
    const rows = stmts.getAllDailyStatus.all(startDateStr);
    
    // Group by monitor_id
    const byMonitor = {};
    for (const row of rows) {
      if (!byMonitor[row.monitor_id]) {
        byMonitor[row.monitor_id] = [];
      }
      byMonitor[row.monitor_id].push({
        date: row.date,
        status: row.status,
        downtimeMinutes: row.downtime_minutes,
        checksTotal: row.checks_total,
        checksFailed: row.checks_failed,
      });
    }
    
    return byMonitor;
  },

  // Initialize today's status for monitors that don't have an entry yet
  initializeTodayStatus: (monitors) => {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const updatedAt = now.toISOString();
    
    const insertMany = db.transaction((items) => {
      for (const monitor of items) {
        const status = monitor.attributes?.status || 'unknown';
        // Only insert if no entry exists for today (don't overwrite)
        const existing = stmts.getDailyStatusForMonitor.all(monitor.id, today);
        if (existing.length === 0) {
          stmts.setDailyStatusDirect.run(
            monitor.id,
            today,
            status,
            0,
            0,
            0,
            updatedAt
          );
        }
      }
    });
    insertMany(monitors);
  },

  // Close database connection
  close: () => {
    db.close();
  },
};

module.exports = database;
