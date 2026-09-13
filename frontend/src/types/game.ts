// 与后端 main.py 中 _view_for / 广播事件对齐的类型定义。
// 公司编号 = 卡牌面值,取值 5~10;面值 n 的公司共有 n 张卡牌。

export type Card = 5 | 6 | 7 | 8 | 9 | 10;

export interface PlayerView {
  name: string;
  seat: number;
  ready: boolean;
  is_host: boolean;
  /** WebSocket 是否在线(断线玩家在宽限期后会被移出房间) */
  online?: boolean;
  money?: number;
  score?: number;
  /** JSON 对象键为字符串("5"~"10") */
  investments?: Record<string, number>;
  antimonopoly?: Record<string, boolean>;
  hand_count?: number;
  /** 仅自己的个性化视图里携带 */
  hand?: Card[];
}

export interface MarketItem {
  company: Card;
  coins_on_top: number;
}

export interface Standing {
  rank: number;
  player_id: string;
  money: number;
  score: number;
  score_delta?: number;
}

export interface RoomView {
  room_id: string;
  host: string;
  max_players: number;
  status: "waiting" | "active" | "finished";
  players: PlayerView[];
  round_number?: number;
  total_rounds?: number;
  current_player?: string;
  turn_phase?: "acquire" | "play";
  /** 当前玩家本回合刚从市场拿走的公司编号(该回合内不能把同公司手牌再上架;非该状态时为 null) */
  took_from_market_company?: Card | null;
  game_status?: "active" | "round_end" | "game_over";
  deck_count?: number;
  removed_count?: number;
  market?: MarketItem[];
  /** 键为字符串公司编号,值为持有者昵称或 null */
  antimonopoly_owner?: Record<string, string | null>;
}

export interface RoundEndEvent {
  round_number: number;
  standings: Standing[];
  payouts: Record<string, { major: string; paid: Record<string, number> }>;
}

export interface GameOverEvent {
  winner: string;
  total_rounds: number;
  standings: Standing[];
}

/** 服务端 WS 消息 */
export type ServerMessage =
  | { type: "room_state"; data: RoomView }
  | { type: "game_started"; data: { message: string } }
  | { type: "action"; data: { player_id: string; message: string; action?: string } }
  | { type: "round_end"; data: RoundEndEvent }
  | { type: "game_over"; data: GameOverEvent }
  | { type: "room_deleted"; data: { reason?: string } };
