const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

/**
 * Notes API service
 *
 * Exposes REST endpoints to create/read/update/delete notes persisted in SQLite.
 *
 * Environment variables:
 * - SQLITE_DB (optional): absolute path to SQLite database file
 * - PORT (optional): server port (default: 5001)
 *
 * Notes:
 * - This service intentionally uses a simple "open CORS" policy so the React frontend
 *   can call it from a separate origin in preview environments.
 */

const app = express();

// Basic JSON parsing
app.use(express.json({ limit: "1mb" }));

// CORS for preview environment; keep permissive as requested for simple integration.
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,PATCH,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Determine DB path.
// Prefer SQLITE_DB env var (already used by db_visualizer/sqlite.env), fallback to the local database/myapp.db.
const DEFAULT_DB_PATH = path.resolve(__dirname, "..", "myapp.db");
const SQLITE_DB_PATH = process.env.SQLITE_DB ? process.env.SQLITE_DB : DEFAULT_DB_PATH;

// Single shared DB connection for simplicity.
// For SQLite this is fine for small apps; node-sqlite3 will serialize access.
const db = new sqlite3.Database(SQLITE_DB_PATH, (err) => {
  if (err) {
    // eslint-disable-next-line no-console
    console.error("Failed to connect to SQLite DB:", err.message);
  } else {
    // eslint-disable-next-line no-console
    console.log(`Connected to SQLite DB at: ${SQLITE_DB_PATH}`);
  }
});

// Initialize schema (id, title, content, created_at as ISO 8601).
function initSchema() {
  db.serialize(() => {
    db.run("PRAGMA foreign_keys = ON");
    db.run(
      `
      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
      `.trim()
    );
    // Helpful index for ordering
    db.run(`CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes(created_at)`);
  });
}

initSchema();

/**
 * Helper to produce ISO 8601 timestamps (UTC) consistently.
 * Example: 2026-01-19T12:34:56.789Z
 */
function nowIso() {
  return new Date().toISOString();
}

/**
 * Promisified helpers for sqlite3.
 */
function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

// PUBLIC_INTERFACE
app.get("/health", async (req, res) => {
  /** Health endpoint for liveness checks. */
  try {
    const row = await getAsync("SELECT 1 as ok");
    res.json({ ok: row && row.ok === 1, db: SQLITE_DB_PATH });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PUBLIC_INTERFACE
app.get("/api/notes", async (req, res) => {
  /**
   * List notes ordered by created_at descending.
   *
   * Returns: Array<{id, title, content, created_at}>
   */
  try {
    const rows = await allAsync(
      `SELECT id, title, content, created_at FROM notes ORDER BY created_at DESC, id DESC`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUBLIC_INTERFACE
app.post("/api/notes", async (req, res) => {
  /**
   * Create a new note.
   *
   * Body: { title: string, content: string }
   * created_at is set by the server to the current ISO 8601 timestamp.
   *
   * Returns: { id, title, content, created_at }
   */
  try {
    const { title, content } = req.body || {};

    if (typeof title !== "string" || title.trim().length === 0) {
      return res.status(400).json({ error: "title is required" });
    }
    if (typeof content !== "string" || content.trim().length === 0) {
      return res.status(400).json({ error: "content is required" });
    }

    const created_at = nowIso();
    const result = await runAsync(
      `INSERT INTO notes (title, content, created_at) VALUES (?, ?, ?)`,
      [title.trim(), content.trim(), created_at]
    );

    const created = await getAsync(
      `SELECT id, title, content, created_at FROM notes WHERE id = ?`,
      [result.lastID]
    );

    res.status(201).json(created);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUBLIC_INTERFACE
app.put("/api/notes/:id", async (req, res) => {
  /**
   * Update a note.
   *
   * Body: { title?: string, content?: string }
   * Returns: updated note.
   */
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "invalid id" });
    }

    const { title, content } = req.body || {};
    const updates = [];
    const params = [];

    if (title !== undefined) {
      if (typeof title !== "string" || title.trim().length === 0) {
        return res.status(400).json({ error: "title must be a non-empty string" });
      }
      updates.push("title = ?");
      params.push(title.trim());
    }

    if (content !== undefined) {
      if (typeof content !== "string" || content.trim().length === 0) {
        return res.status(400).json({ error: "content must be a non-empty string" });
      }
      updates.push("content = ?");
      params.push(content.trim());
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "nothing to update" });
    }

    params.push(id);

    const result = await runAsync(`UPDATE notes SET ${updates.join(", ")} WHERE id = ?`, params);
    if (result.changes === 0) {
      return res.status(404).json({ error: "note not found" });
    }

    const updated = await getAsync(
      `SELECT id, title, content, created_at FROM notes WHERE id = ?`,
      [id]
    );
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUBLIC_INTERFACE
app.delete("/api/notes/:id", async (req, res) => {
  /**
   * Delete a note by id.
   *
   * Returns: { deleted: boolean }
   */
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "invalid id" });
    }

    const result = await runAsync(`DELETE FROM notes WHERE id = ?`, [id]);
    if (result.changes === 0) {
      return res.status(404).json({ error: "note not found" });
    }

    res.json({ deleted: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 5001;
app.listen(PORT, "0.0.0.0", () => {
  // eslint-disable-next-line no-console
  console.log(`Notes API listening on http://0.0.0.0:${PORT}`);
});
