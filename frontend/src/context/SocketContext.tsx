import React, { createContext, useContext, useEffect, useState } from "react";

// 定义 socket 上下文类型
interface SocketContextType {
  socket: WebSocket | null;
  isConnected: boolean;
  connect: (roomId: string, playerId: string) => void;
  disconnect: () => void;
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
  connect: () => {},
  disconnect: () => {},
});

// 使用 socket 的 Hook
export const useSocket = () => useContext(SocketContext);

// 提供者组件
interface SocketProviderProps {
  children: React.ReactNode;
}

export const SocketProvider: React.FC<SocketProviderProps> = ({ children }) => {
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const connect = (roomId: string, playerId: string) => {
    // 如果已经连接，先断开
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close();
    }

    // 注意：原生 WebSocket 使用 ws:// 或 wss:// 协议
    const SOCKET_URL = `ws://47.108.74.28:80/ws/${roomId}/${playerId}`;

    console.log("正在连接 WebSocket:", SOCKET_URL);
    const newSocket = new WebSocket(SOCKET_URL);

    newSocket.onopen = () => {
      console.log("WebSocket 已连接");
      setIsConnected(true);
    };

    newSocket.onclose = () => {
      console.log("WebSocket 已断开");
      setIsConnected(false);
    };

    newSocket.onerror = (err) => {
      console.error("WebSocket 连接错误:", err);
      // 注意：WebSocket 的 error 事件通常不包含详细的错误信息
    };

    setSocket(newSocket);
  };

  const disconnect = () => {
    if (socket) {
      socket.close();
      setSocket(null);
      setIsConnected(false);
    }
  };

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (socket) {
        socket.close();
      }
    };
  }, []);

  return (
    <SocketContext.Provider value={{ socket, isConnected, connect, disconnect }}>
      {children}
    </SocketContext.Provider>
  );
};
