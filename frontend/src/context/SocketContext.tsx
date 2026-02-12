import React, { createContext, useContext, useEffect, useState } from "react";

// 定义 socket 上下文类型
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

// 使用 socket 的 Hook
export const useSocket = () => useContext(SocketContext);

// 提供者组件
interface SocketProviderProps {
  children: React.ReactNode;
}

export const SocketProvider: React.FC<SocketProviderProps> = ({ children }) => {
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const  api=import.meta.env.VITE_API_BASE_URL
  const connect = (roomId: string, playerId: string) => {
    // 如果已经连接，先断开
    if (socket && socket.readyState === WebSocket.OPEN) {
      console.log("重复链接!");
      socket.close();
    }

    // 注意：原生 WebSocket 使用 ws:// 或 wss:// 协议
    const SOCKET_URL = `ws://${api}/${roomId}/${playerId}`;

    console.log("正在连接 WebSocket:", SOCKET_URL);
    const newSocket = new WebSocket(SOCKET_URL);
    console.log(" WebSocket:", SOCKET_URL,"success！");

    newSocket.onmessage=(event)=>{
      const data = JSON.parse(event.data);
      console.log("📥 收到服务器消息:", data);
    };


    newSocket.onopen = (event) => {

      setIsConnected(true);
      console.log("WebSocket 已连接");

    };

    newSocket.onclose = () => {
      console.log(`🔌 WebSocket closed [${event.code}]`, {
        reason: event.reason,
        wasClean: event.wasClean,
        url: newSocket.url
      });

      if (event.code === 1006) {
        console.warn("⚠️ 连接异常中断，可能是后端未启动或路径错误");
      }
      setIsConnected(false);
      console.log("WebSocket 已断开");

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
