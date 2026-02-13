// SocketContext.tsx
import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from "react";

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'localhost:8080';

interface SocketContextType {
  socket: WebSocket | null;
  isConnected: boolean;
  connect: (roomId: string, playerName: string) => void;
  disconnect: () => void;
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
  connect: () => {},
  disconnect: () => {},
});

export const useSocket = () => useContext(SocketContext);

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);

  const connect = useCallback((roomId: string, playerName: string) => {
    const url = `ws://${API_BASE}/${roomId}/${playerName}`;

    const currentWs=socketRef.current

    // ✅ 1. 如果已经连接且 URL 相同，什么都不做
    if (currentWs?.url === url &&
        currentWs.readyState === WebSocket.OPEN) {
      return;
    }

    // ✅ 2. 如果正在连接中且 URL 相同，等待即可
    if (currentWs?.url === url &&
        currentWs.readyState === WebSocket.CONNECTING) {
      return;
    }

    // ✅ 3. 只有 URL 不同时，才关闭旧连接
    if (currentWs && currentWs.url !== url) {
      console.log(currentWs.url)
      console.log(url)
      currentWs.close();
    }

    console.log("🔌 Connecting to:", url);
    const ws = new WebSocket(url);
    socketRef.current = ws;
    setSocket(ws);

    ws.onopen = () => {
      setIsConnected(true);
      console.log("✅ WebSocket 连接");
    };

    ws.onclose = (event) => {
      setIsConnected(false);
      console.warn("🔌 WebSocket 断开", event.code, event.reason);
    };

    ws.onerror = (error) => {
      console.error("❌ WebSocket error", error);
    };

    // 注意：不要在这里设置 onmessage！让组件自己 addEventListener
  }, []);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      console.trace('🔴 disconnect() 被调用！调用栈：');
      socketRef.current.close();
    }
  }, []);

  // 应用卸载时清理
  useEffect(() => {
    return () => {
      if (socketRef.current) {
        console.log("组件卸载!")
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