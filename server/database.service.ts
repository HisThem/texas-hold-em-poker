import { Injectable } from '@nestjs/common';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { HandHistoryEntry, RoomConfig } from '../shared/game';

interface SessionRecord {
  token: string;
  playerId: string;
  roomCode: string;
  seat: number;
}

@Injectable()
export class DatabaseService {
  private readonly db: DatabaseSync;

  constructor() {
    const directory = resolve(process.cwd(), 'server', 'data');
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(resolve(directory, 'holdem.sqlite'));
    this.initialize();
  }

  saveRoom(roomCode: string, hostId: string, config: RoomConfig, nextConfig: RoomConfig | null, handNo: number) {
    this.db
      .prepare(`
        INSERT INTO rooms (code, host_id, config_json, next_config_json, hand_no, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(code) DO UPDATE SET
          host_id = excluded.host_id,
          config_json = excluded.config_json,
          next_config_json = excluded.next_config_json,
          hand_no = excluded.hand_no,
          updated_at = datetime('now')
      `)
      .run(roomCode, hostId, JSON.stringify(config), nextConfig ? JSON.stringify(nextConfig) : null, handNo);
  }

  savePlayer(playerId: string, name: string, isBot: boolean) {
    this.db
      .prepare(`
        INSERT INTO players (id, name, is_bot, created_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          is_bot = excluded.is_bot
      `)
      .run(playerId, name, isBot ? 1 : 0);
  }

  saveMembership(roomCode: string, playerId: string, seat: number, isActive: boolean) {
    this.db
      .prepare(`
        INSERT INTO room_memberships (room_code, player_id, seat, is_active, joined_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(room_code, player_id) DO UPDATE SET
          seat = excluded.seat,
          is_active = excluded.is_active
      `)
      .run(roomCode, playerId, seat, isActive ? 1 : 0);
  }

  saveSession(token: string, playerId: string, roomCode: string, seat: number) {
    this.db
      .prepare(`
        INSERT INTO player_sessions (token, player_id, room_code, seat, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(token) DO UPDATE SET
          player_id = excluded.player_id,
          room_code = excluded.room_code,
          seat = excluded.seat,
          updated_at = datetime('now')
      `)
      .run(token, playerId, roomCode, seat);
  }

  deleteSession(token: string) {
    this.db.prepare('DELETE FROM player_sessions WHERE token = ?').run(token);
  }

  findSession(token: string): SessionRecord | null {
    const row = this.db.prepare('SELECT token, player_id, room_code, seat FROM player_sessions WHERE token = ?').get(token) as
      | { token: string; player_id: string; room_code: string; seat: number }
      | undefined;
    if (!row) return null;
    return {
      token: row.token,
      playerId: row.player_id,
      roomCode: row.room_code,
      seat: row.seat,
    };
  }

  saveHandHistory(roomCode: string, entry: HandHistoryEntry) {
    this.db
      .prepare(`
        INSERT INTO hand_history (room_code, hand_no, payload_json, created_at)
        VALUES (?, ?, ?, datetime('now'))
      `)
      .run(roomCode, entry.handNo, JSON.stringify(entry));
  }

  private initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        code TEXT PRIMARY KEY,
        host_id TEXT NOT NULL,
        config_json TEXT NOT NULL,
        next_config_json TEXT,
        hand_no INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        is_bot INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS room_memberships (
        room_code TEXT NOT NULL,
        player_id TEXT NOT NULL,
        seat INTEGER NOT NULL,
        is_active INTEGER NOT NULL,
        joined_at TEXT NOT NULL,
        PRIMARY KEY (room_code, player_id)
      );

      CREATE TABLE IF NOT EXISTS player_sessions (
        token TEXT PRIMARY KEY,
        player_id TEXT NOT NULL,
        room_code TEXT NOT NULL,
        seat INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hand_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_code TEXT NOT NULL,
        hand_no INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }
}
