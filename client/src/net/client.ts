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

    ws.onclose = () => {
      if (this.ws !== ws) return; // stale — disconnect() already opened a fresh one
      this.ws = null;
      if (this.shouldReconnect) {
        this.reconnectTimer = setTimeout(() => this._open(), 2000);
      }
    };
  }

  private _getToken(): string {
    let token = localStorage.getItem('smToken');
    if (!token) {
      token = crypto.randomUUID();
      localStorage.setItem('smToken', token);
    }
    return token;
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
