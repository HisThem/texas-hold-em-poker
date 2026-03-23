# Texas Hold'em Multiplayer

This project now contains:

- A React/Vite frontend on port `3000`
- A NestJS + Socket.IO backend on port `3101`
- SQLite persistence at `server/data/holdem.sqlite`

## Run locally

1. Install dependencies

```bash
npm install
```

2. Start both frontend and backend

```bash
npm run dev
```

3. Open `http://localhost:3000`

If you want to run them separately for debugging:

```bash
npm run dev:server
npm run dev:client
```

## Current multiplayer flow

- Enter a nickname and a 6-digit room code
- A new room is created automatically if the code does not exist
- Reusing the same room code joins the same room
- The first player in a room is the host
- Hosts can change player count, presets, removed ranks, and bot-fill behavior

## Checks

```bash
npm run lint
npm run build
```
