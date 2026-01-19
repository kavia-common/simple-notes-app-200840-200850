# Notes API (SQLite)

Minimal Express REST API to persist and read notes from the existing SQLite database.

## Environment variables

- `SQLITE_DB` (optional): absolute path to the SQLite database file.
  - If not set, defaults to `../myapp.db` relative to this folder.
- `PORT` (optional): port to listen on (default: `5001`).

The existing workspace already includes a helper env file used by the DB visualizer:

- `../db_visualizer/sqlite.env` contains `export SQLITE_DB=".../database/myapp.db"`

## Run locally (example)

```bash
cd simple-notes-app-200840-200850/database/notes_api
# If needed:
# npm install
source ../db_visualizer/sqlite.env
PORT=5001 node server.js
```

## API

- `GET /api/notes` -> list notes ordered by `created_at DESC`
- `POST /api/notes` body `{ "title": "...", "content": "..." }` -> creates note (server sets `created_at`)
- `PUT /api/notes/:id` (optional) -> update title/content
- `DELETE /api/notes/:id` (optional) -> delete note
- `GET /health` -> health check
