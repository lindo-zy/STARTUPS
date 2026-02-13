// 房间相关的API服务
import apiClient from "./client";

// 创建房间
interface CreateRoomParams {
  host_player_name: string;
  max_players?: number;
}

export const createRoom = async (params: CreateRoomParams) => {
  // const { host_player_id, max_players = 7 } = params;
  return apiClient.post("/room/create", null, {
    params: params,
  });
};

// 列出房间
export const listRooms = async () => {
  return apiClient.get("/room/list");
};

// 加入房间
interface JoinRoomParams {
  room_id: string;
  player_name: string;
}

export const joinRoom = async (params: JoinRoomParams) => {
  return apiClient.post("/room/join", null, {
    params,
  });
};

// 离开房间
interface LeaveRoomParams {
  room_id: string;
  player_name: string;
}

export const leaveRoom = async (params: LeaveRoomParams) => {
  return apiClient.post("/room/leave", null, {
    params,
  });
};

// 开始游戏
interface StartGameParams {
  room_id: string;
  host_player_name: string;
}

export const startGame = async (params: StartGameParams) => {
  return apiClient.post("/room/start", null, {
    params,
  });
};

// 删除房间
interface DeleteRoomParams {
  room_id: string;
  requester_id: string;
}

export const deleteRoom = async (params: DeleteRoomParams) => {
  return apiClient.delete("/room/delete", {
    params,
  });
};

// 获取房间信息
export const getRoom = async (room_id: string) => {
  return apiClient.get(`/room/${room_id}`);
};

// 从牌堆抽牌
interface DrawFromDeckParams {
  room_id: string;
  player_id: string;
}

export const drawFromDeck = async (params: DrawFromDeckParams) => {
  return apiClient.post("/room/action/draw", null, {
    params,
  });
};

// 从市场拿牌
interface TakeFromMarketParams {
  room_id: string;
  player_id: string;
  card_index: number;
}

export const takeFromMarket = async (params: TakeFromMarketParams) => {
  return apiClient.post("/room/action/take", null, {
    params,
  });
};

// 出牌
interface PlayCardParams {
  room_id: string;
  player_id: string;
  card_company: string;
  action: "invest" | "to_market";
}

export const playCard = async (params: PlayCardParams) => {
  return apiClient.post("/room/action/play", null, {
    params,
  });
};
