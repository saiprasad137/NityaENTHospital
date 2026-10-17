# Nitya ENT Hospital

A modern, responsive web application and administration portal for **Nitya ENT Hospital**, featuring doctor schedules, appointment booking, hospital updates & achievements, Google reviews, and a secure administration control panel.

---

## Tech Stack

- **Monorepo**: pnpm workspaces + TypeScript 5.9
- **Frontend** (`artifacts/nitya-ent`): React 19, Vite 7, Tailwind CSS 4, Radix UI, TanStack React Query, Wouter, Clerk React
- **Backend API** (`artifacts/api-server`): Node.js, Express 5, Pino Logger, Clerk Express
- **Database** (`lib/db`): PostgreSQL + Drizzle ORM
- **API Spec & Contracts**: OpenAPI (`lib/api-spec`), Orval, Zod (`lib/api-zod`), React Query client (`lib/api-client-react`)

---

## Project Structure

```
├── artifacts/
│   ├── nitya-ent/         # React frontend application (Vite)
│   └── api-server/        # Express API backend server
├── lib/
│   ├── api-spec/          # OpenAPI specifications and Orval codegen config
│   ├── api-zod/           # Auto-generated Zod request/response validation schemas
│   ├── api-client-react/  # Auto-generated React Query hooks for the frontend
│   └── db/                # Drizzle schema definitions and database client
├── scripts/               # Utility scripts
├── package.json           # Workspace root scripts
├── pnpm-workspace.yaml    # Workspace configuration & dependency catalog
└── .env.example           # Environment variable template
```

---

## Getting Started

### 1. Prerequisites

- [Node.js](https://nodejs.org/) (version 20 or higher, v22+ recommended)
- [pnpm](https://pnpm.io/) (version 9 or higher)
- [PostgreSQL](https://www.postgresql.org/) database

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Configure Environment Variables

Copy the template file to `.env`:

```bash
cp .env.example .env
```

Edit `.env` to configure:
- `DATABASE_URL`: Your PostgreSQL connection string (e.g. `postgresql://postgres:postgres@localhost:5432/nitya_ent`)
- `PORT`: API server port (default: `8080`)
- `CLERK_PUBLISHABLE_KEY` & `CLERK_SECRET_KEY`: (Optional) Required for admin sign-in. The public hospital site functions without Clerk configured.
- `ADMIN_EMAILS`: Comma-separated admin email addresses.

### 4. Initialize Database Schema

Push the database tables to your Postgres instance:

```bash
pnpm db:push
```

### 5. Run Local Development

To start both the API server and Vite frontend simultaneously:

```bash
pnpm dev
```

- **Frontend**: [http://localhost:3000](http://localhost:3000) (requests to `/api` are automatically proxied to port 8080)
- **API Server**: [http://localhost:8080](http://localhost:8080)

You can also run services independently:

```bash
# Run API server only (auto-restarts on change)
pnpm dev:api

# Run Vite frontend only
pnpm dev:web
```

---

## Useful Commands

| Command | Description |
|---|---|
| `pnpm dev` | Run API server and frontend together in dev mode |
| `pnpm dev:api` | Run backend API server with `tsx watch` |
| `pnpm dev:web` | Run frontend Vite dev server with HMR |
| `pnpm build` | Typecheck all packages and build both apps for production |
| `pnpm start` | Run production API server (serves both API & built frontend) |
| `pnpm typecheck` | Run full TypeScript typecheck across all workspace packages |
| `pnpm db:push` | Push schema changes directly to PostgreSQL (via Drizzle Kit) |
| `pnpm codegen` | Regenerate API client hooks and Zod schemas from OpenAPI spec |

---

## Production Deployment

### Single-Server Standalone Deployment

The backend server is configured to serve the frontend static build from `artifacts/nitya-ent/dist/public` when built:

```bash
# 1. Build everything
pnpm build

# 2. Start the server (runs API on /api and SPA on /)
pnpm start
```