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

    // 如果已在连接相同地址，跳过
    if (socketRef.current?.url === url && socketRef.current.readyState === WebSocket.OPEN) {
      return;
    }

    // 关闭旧连接
    if (socketRef.current) {
      socketRef.current.close();
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
    // if (socketRef.current) {
    //   socketRef.current.close();
    // }
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