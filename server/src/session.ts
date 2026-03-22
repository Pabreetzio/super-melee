interface Session {
  sessionId: string;
  commanderName: string;
}

class SessionManager {
  private sessions = new Map<string, Session>();

  getOrCreate(sessionId: string): Session {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, { sessionId, commanderName: '' });
    }
    return this.sessions.get(sessionId)!;
  }

  setName(sessionId: string, name: string): void {
    const s = this.sessions.get(sessionId);
    if (s) s.commanderName = name.slice(0, 30);
  }
}

export const sessions = new SessionManager();
