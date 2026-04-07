import type { ClientMsg, ServerMsg } from 'shared/types';

type Listener = (msg: ServerMsg) => void;
type ConnectListener = () => void;

export class GameClient {
  private ws: WebSocket | null = null;
  private listeners: Listener[] = [];
  private connectListeners: ConnectListener[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;

  connect() {
    this.shouldReconnect = true;
    this._open();
  }

  private _open() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = this._getToken();
    const url = `${proto}//${window.location.host}/ws?token=${token}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) { ws.close(); return; } // stale — newer socket took over
      if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
      this.connectListeners.forEach(l => l());
    };

    ws.onmessage = (ev) => {
      if (this.ws !== ws) return; // stale
      try {
        const msg = JSON.parse(ev.data as string) as ServerMsg;
        this.listeners.forEach(l => l(msg));
      } catch {
        // malformed message — ignore
      }
    };

    ws.onclose = (ev) => {
      if (this.ws !== ws) return; // stale — disconnect() already opened a fresh one
      this.ws = null;
      if (ev.code === 4001) {
        // Server closed this connection because another tab opened with the same
        // session token. With sessionStorage this should never happen anymore,
        // but log it prominently if it does.
        console.warn('[WS] Kicked by server (4001) — another tab is using the same session token. Check for duplicate tabs.');
      }
      if (this.shouldReconnect) {
        this.reconnectTimer = setTimeout(() => this._open(), 2000);
      }
    };
  }

  private _getToken(): string {
    // sessionStorage is scoped per tab, so multiple tabs don't share a session
    // ID and fight each other (each new tab connection kicks the previous one,
    // causing a 2s reconnect loop). localStorage would persist across tabs.
    // On page refresh within the same tab, sessionStorage survives, so the
    // server's room-restore path still works after an accidental refresh.
    let token = sessionStorage.getItem('smToken');
    if (!token) {
      token = this._makeToken();
      sessionStorage.setItem('smToken', token);
    }
    return token;
  }

  private _makeToken(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }

    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0'));
      return [
        hex.slice(0, 4).join(''),
        hex.slice(4, 6).join(''),
        hex.slice(6, 8).join(''),
        hex.slice(8, 10).join(''),
        hex.slice(10, 16).join(''),
      ].join('-');
    }

    return `sm-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  }

  send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  onMessage(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter(l => l !== listener); };
  }

  onConnect(listener: ConnectListener): () => void {
    this.connectListeners.push(listener);
    return () => { this.connectListeners = this.connectListeners.filter(l => l !== listener); };
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export const client = new GameClient();
