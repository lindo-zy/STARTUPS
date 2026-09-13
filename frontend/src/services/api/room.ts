// 房间与游戏相关的 API 服务(与后端 main.py 路由对齐)
import apiClient from "./client";
import type { RoomView } from "../../types/game";

/** 创建/加入房间返回的玩家身份 */
export interface Identity {
  room_id: string;
  token: string;
  seat: number;
}

export interface RoomSummary {
  room_id: string;
  host: string;
  player_count: number;
  max_players: number;
  status: string;
}

// 身份令牌存 sessionStorage(每个标签页独立),避免多开标签页时
// 互相覆盖 localStorage 里的同一个 key,导致"点准备报身份校验失败"。
// 刷新页面 sessionStorage 仍保留,断线重连/刷新恢复不受影响。
export const getStoredToken = () => sessionStorage.getItem("token") || "";
export const storeIdentity = (token: string, roomId: string) => {
  sessionStorage.setItem("token", token);
  sessionStorage.setItem("roomId", roomId);
};

const authParams = (roomId: string, playerName: string) => ({
  room_id: roomId,
  player_name: playerName,
  token: getStoredToken(),
});

// 创建房间
export const createRoom = (player_name: string) => {
  return apiClient.post<never, Identity>("/room/create", null, {
    params: { player_name },
  });
};

// 列出房间
export const listRooms = () => {
  return apiClient.post<never, RoomSummary[]>("/room/list");
};

// 加入房间
export const joinRoom = (room_id: string, player_name: string) => {
  return apiClient.post<never, Identity>("/room/join", null, {
    params: { room_id, player_name },
  });
};

// 准备/取消准备
export const readyRoom = (room_id: string, player_name: string, ready: boolean) => {
  return apiClient.post<never, RoomView>("/room/ready", null, {
    params: { ...authParams(room_id, player_name), ready },
  });
};

// 离开房间(房主离开会解散房间)
export const leaveRoom = (room_id: string, player_name: string) => {
  return apiClient.post<never, null>("/room/leave", null, {
    params: authParams(room_id, player_name),
  });
};

// 解散房间(仅房主)
export const deleteRoom = (room_id: string, player_name: string) => {
  return apiClient.delete<never, null>("/room/delete", {
    params: authParams(room_id, player_name),
  });
};

// 移出玩家(仅房主,仅等待期)
export const kickPlayer = (room_id: string, player_name: string, target_player_name: string) => {
  return apiClient.post<never, RoomView>("/room/kick", null, {
    params: { ...authParams(room_id, player_name), target_player_name },
  });
};

// 添加 AI 机器人(仅房主,仅等待期;开局后由服务端代打)
export const addBot = (room_id: string, player_name: string) => {
  return apiClient.post<never, RoomView>("/room/add_bot", null, {
    params: authParams(room_id, player_name),
  });
};

// 获取房间公共信息(不含手牌)
export const getRoom = (room_id: string) => {
  return apiClient.get<never, RoomView>(`/room/${room_id}`);
};

// 开始游戏(仅房主,total_rounds 为总轮数)
export const startGame = (room_id: string, player_name: string, total_rounds: number) => {
  return apiClient.post<never, RoomView>("/room/start", null, {
    params: { ...authParams(room_id, player_name), total_rounds },
  });
};

// 从牌堆抽牌
export const drawFromDeck = (room_id: string, player_name: string) => {
  return apiClient.post<never, RoomView>("/room/action/draw", null, {
    params: authParams(room_id, player_name),
  });
};

// 从市场拿牌
export const takeFromMarket = (room_id: string, player_name: string, card_index: number) => {
  return apiClient.post<never, RoomView>("/room/action/take", null, {
    params: { ...authParams(room_id, player_name), card_index },
  });
};

// 出牌:投资(invest)或上架到市场(to_market)
export const playCard = (
  room_id: string,
  player_name: string,
  card_company: number,
  action: "invest" | "to_market",
) => {
  return apiClient.post<never, RoomView>("/room/action/play", null, {
    params: { ...authParams(room_id, player_name), card_company, action },
  });
};
