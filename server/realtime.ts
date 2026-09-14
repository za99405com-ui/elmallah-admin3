import { Response } from 'express';

interface RealtimeClient {
  id: string;
  res: Response;
  adminId?: string;
}

const clients: Map<string, RealtimeClient> = new Map();

export function addRealtimeClient(id: string, res: Response, adminId?: string): void {
  clients.set(id, { id, res, adminId });

  try {
    // Send 2KB initial comment padding to bypass buffering in Nginx and Cloud reverse proxies
    res.write(`: padding ${' '.repeat(2048)}\n\n`);
    res.write(`event: connected\ndata: ${JSON.stringify({ message: 'Connected to Almallah Realtime SSE stream', timestamp: Date.now() })}\n\n`);
  } catch {
    clients.delete(id);
  }

  // Handle client disconnect
  res.on('close', () => {
    clients.delete(id);
  });
}

export function removeRealtimeClient(id: string): void {
  clients.delete(id);
}

export function broadcastRealtimeEvent(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [id, client] of clients.entries()) {
    try {
      client.res.write(payload);
    } catch {
      clients.delete(id);
    }
  }
}

// Heartbeat every 15s to keep connections alive across reverse proxies and load balancers
setInterval(() => {
  for (const [id, client] of clients.entries()) {
    try {
      client.res.write(': ping\n\n');
    } catch {
      clients.delete(id);
    }
  }
}, 15000);
