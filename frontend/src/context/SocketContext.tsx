// SocketContext.tsx
import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from "react";

// VITE_API_BASE_URL 为空时用页面自身的 host(同源部署,https 下自动用 wss)
const apiBase = (import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/$/, "");
const WS_BASE = apiBase
  ? `ws://${apiBase}`
  : `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`;

interface SocketContextType {
  socket: WebSocket | null;
  isConnected: boolean;
  connect: (roomId: string, playerName: string, token: string) => void;
  disconnect: () => void;
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
  connect: () => {},
  disconnect: () => {},
});

// eslint-disable-next-line react-refresh/only-export-components
export const useSocket = () => useContext(SocketContext);

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);

  const connect = useCallback((roomId: string, playerName: string, token: string) => {
    const url = `${WS_BASE}/${roomId}/${encodeURIComponent(
      playerName,
    )}?token=${encodeURIComponent(token)}`;

    const currentWs = socketRef.current;

    // 1. 已经连接且 URL 相同,什么都不做
    if (currentWs?.url === url && currentWs.readyState === WebSocket.OPEN) {
      return;
    }

    // 2. 正在连接中且 URL 相同,等待即可
    if (currentWs?.url === url && currentWs.readyState === WebSocket.CONNECTING) {
      return;
    }

    // 3. URL 不同时,关闭旧连接
    if (currentWs && currentWs.url !== url) {
      currentWs.onclose = null; // 主动替换连接,不触发旧连接的断开回调
      currentWs.close();
    }

    const ws = new WebSocket(url);
    socketRef.current = ws;
    setSocket(ws);

    ws.onopen = () => {
      setIsConnected(true);
    };

    ws.onclose = (event) => {
      setIsConnected(false);
      if (event.code === 1008) {
        console.warn("WebSocket 鉴权失败或已不在房间中", event.reason);
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error", error);
    };

    // 注意:不要在这里设置 onmessage!让组件自己 addEventListener
  }, []);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.onclose = null;
      socketRef.current.close();
      socketRef.current = null;
      setSocket(null);
      setIsConnected(false);
    }
  }, []);

  // 应用卸载时清理
  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, []);

  return (
    <SocketContext.Provider value={{ socket, isConnected, connect, disconnect }}>
      {children}
    </SocketContext.Provider>
  );
};
