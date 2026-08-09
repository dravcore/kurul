import { io, type Socket } from 'socket.io-client';
import { getApiBaseUrl } from '@/lib/api';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(getApiBaseUrl(), {
      autoConnect: false,
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });
  }
  return socket;
}

export function connectSocket(): Socket {
  const client = getSocket();
  if (!client.connected) {
    client.connect();
  }
  return client;
}

export function disconnectSocket(): void {
  if (!socket) return;
  socket.disconnect();
  socket = null;
}
