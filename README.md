# Gravity - Turn-Based Multiplayer Board Game

A complex turn-based multiplayer board game featuring asynchronous gameplay, bot support, and cross-platform portability.

## Project Structure

This is a monorepo containing three packages:

- **@gravity/core** - Platform-agnostic game engine and logic
- **@gravity/server** - Node.js backend API and services
- **@gravity/web** - React web client

## Prerequisites

- Node.js >= 20.0.0
- npm >= 10.0.0
- Docker and Docker Compose (for local development)

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Start Development Services

Start PostgreSQL and Redis using Docker:

```bash
npm run docker:up
```

### 3. Set Up Environment Variables

Copy `.env.example` to `.env` in the server package:

```bash
cp packages/server/.env.example packages/server/.env
```

### 4. Run Database Migrations

```bash
cd packages/server
npm run db:migrate
```

### 5. Start Development Servers

```bash
# Run all packages in development mode
npm run dev
```

This will start:
- Core package in watch mode (builds TypeScript)
- Server on http://localhost:3000
- Web client on http://localhost:5173

## Development

### Run Tests

```bash
npm test
```

### Build All Packages

```bash
npm run build
```

### Clean Build Artifacts

```bash
npm run clean
```

## Architecture

See [CODING_STANDARDS.md](./CODING_STANDARDS.md) for coding guidelines.

See the architecture plan at `.claude/plans/zippy-rolling-thimble.md` for detailed technical documentation.

## Tech Stack

- **Frontend**: React 18+, TypeScript, Zustand, Tailwind CSS, Vite
- **Backend**: Node.js, Express, Socket.io, PostgreSQL, Redis, BullMQ
- **Game Logic**: TypeScript (shared across platforms)
- **Database**: PostgreSQL 16+ with Drizzle ORM
- **Testing**: Vitest

## License

Proprietary
