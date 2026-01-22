import asyncio
import random
import uuid
from enum import Enum
from typing import Dict, List, Optional, Literal, Set

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

app = FastAPI(title="Startup Tycoon - Card Investment Game with WebSocket")

# ====== 常量 ======
COMPANIES = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"]
COMPANY_CARD_COUNTS = {
    "Alpha": 5,
    "Beta": 6,
    "Gamma": 7,
    "Delta": 8,
    "Epsilon": 9,
    "Zeta": 10,
}


# ====== 数据模型（同前）======
class PlayerState(BaseModel):
    player_id: str
    hand: List[str]
    investments: Dict[str, int]
    money: int
    score: int
    has_antimonopoly: Dict[str, bool]


class MarketCard(BaseModel):
    company: str
    coins_on_top: int = 0


class GameState(BaseModel):
    game_id: str
    players: Dict[str, PlayerState]
    market_deck: List[str]
    market_display: List[MarketCard]
    removed_cards: List[str]
    current_player_id: str
    round_number: int
    status: Literal["active", "round_end", "game_over"]
    antimonopoly_owner: Dict[str, Optional[str]]


class RoomStatus(str, Enum):
    waiting = "waiting"
    active = "active"
    finished = "finished"


class Room(BaseModel):
    room_id: str
    host_player_id: str
    max_players: int
    players: List[str]
    status: RoomStatus
    game_state: Optional[GameState] = None


# ====== 全局状态 ======
rooms: Dict[str, Room] = {}

# WebSocket 连接管理：room_id -> set of WebSocket
websocket_connections: Dict[str, Set[WebSocket]] = {}


# ====== 广播工具函数 ======
async def broadcast_to_room(room_id: str, message: dict):
    """向指定房间的所有 WebSocket 客户端广播消息"""
    if room_id not in websocket_connections:
        return
    dead_connections = set()
    for ws in websocket_connections[room_id]:
        try:
            await ws.send_json(message)
        except Exception:
            dead_connections.add(ws)
    # 清理断开的连接
    for ws in dead_connections:
        websocket_connections[room_id].discard(ws)


# ====== 游戏逻辑辅助函数（同前）======
def _create_game_state(player_ids: List[str]) -> GameState:
    full_deck = []
    for comp, count in COMPANY_CARD_COUNTS.items():
        full_deck.extend([comp] * count)
    random.shuffle(full_deck)
    removed = [full_deck.pop() for _ in range(5)]
    market_deck = full_deck.copy()

    players = {}
    for pid in player_ids:
        hand = [market_deck.pop() for _ in range(3)]
        players[pid] = PlayerState(
            player_id=pid,
            hand=hand,
            investments={c: 0 for c in COMPANIES},
            money=10,
            score=0,
            has_antimonopoly={c: False for c in COMPANIES},
        )

    antimonopoly_owner = {c: None for c in COMPANIES}

    return GameState(
        game_id=f"game_{player_ids[0]}",
        players=players,
        market_deck=market_deck,
        market_display=[],
        removed_cards=removed,
        current_player_id=player_ids[0],
        round_number=1,
        status="active",
        antimonopoly_owner=antimonopoly_owner,
    )


def _update_antimonopoly_token(game: GameState, company: str):
    holdings = [(pid, p.investments[company]) for pid, p in game.players.items()]
    max_holding = max(holdings, key=lambda x: x[1])[1]
    if max_holding == 0:
        game.antimonopoly_owner[company] = None
        return
    leaders = [pid for pid, h in holdings if h == max_holding]
    if len(leaders) == 1:
        new_owner = leaders[0]
        old_owner = game.antimonopoly_owner[company]
        if old_owner != new_owner:
            if old_owner:
                game.players[old_owner].has_antimonopoly[company] = False
            game.antimonopoly_owner[company] = new_owner
            game.players[new_owner].has_antimonopoly[company] = True
    else:
        old_owner = game.antimonopoly_owner[company]
        if old_owner:
            game.players[old_owner].has_antimonopoly[company] = False
        game.antimonopoly_owner[company] = None


def _end_round(game: GameState):
    for player in game.players.values():
        for card in player.hand:
            player.investments[card] += 1
        player.hand.clear()

    for company in COMPANIES:
        holdings = [(pid, p.investments[company]) for pid, p in game.players.items()]
        max_holding = max(holdings, key=lambda x: x[1])[1]
        if max_holding == 0:
            continue
        leaders = [pid for pid, h in holdings if h == max_holding]
        if len(leaders) != 1:
            continue
        major = leaders[0]
        for pid, shares in holdings:
            if pid == major:
                continue
            owed = shares * 3
            payer = game.players[pid]
            receiver = game.players[major]
            receiver.money += min(payer.money, owed)
            payer.money -= owed

    sorted_players = sorted(game.players.values(), key=lambda p: p.money, reverse=True)
    n = len(sorted_players)
    if n >= 2:
        sorted_players[0].score += 2
        sorted_players[1].score += 1
        sorted_players[-1].score -= 1

    if game.round_number >= 2:
        game.status = "game_over"
    else:
        game.round_number += 1
        full_deck = []
        for comp, count in COMPANY_CARD_COUNTS.items():
            full_deck.extend([comp] * count)
        for r in game.removed_cards:
            full_deck.remove(r)
        random.shuffle(full_deck)
        game.market_deck = full_deck
        game.market_display = []
        for p in game.players.values():
            p.hand = [game.market_deck.pop() for _ in range(3)]
        game.current_player_id = list(game.players.keys())[0]
        for comp in COMPANIES:
            _update_antimonopoly_token(game, comp)


def _get_active_room(room_id: str) -> Room:
    if room_id not in rooms:
        raise HTTPException(404, "Room not found")
    room = rooms[room_id]
    if room.status != RoomStatus.active:
        raise HTTPException(400, "Game not active")
    if room.game_state is None:
        raise HTTPException(500, "Game state missing")
    return room


# ====== WebSocket 路由 ======
@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    await websocket.accept()

    # 初始化连接池
    if room_id not in websocket_connections:
        websocket_connections[room_id] = set()
    websocket_connections[room_id].add(websocket)

    try:
        # 可选：发送当前游戏状态快照
        if room_id in rooms:
            room = rooms[room_id]
            await websocket.send_json({"type": "room_state", "data": room.dict()})

        # 保持连接（可接收客户端消息，但本例只用于广播）
        while True:
            await websocket.receive_text()  # 心跳或忽略
    except WebSocketDisconnect:
        pass
    finally:
        # 清理连接
        if room_id in websocket_connections:
            websocket_connections[room_id].discard(websocket)
            if not websocket_connections[room_id]:
                del websocket_connections[room_id]


# ====== 房间管理接口（同前，略作调整以触发广播）======


@app.post("/room/create")
def create_room(host_player_id: str, max_players: int = 6):
    if not host_player_id.strip():
        raise HTTPException(400, "Player ID required")
    if max_players < 3 or max_players > 7:
        raise HTTPException(400, "Max players must be 3–7")
    room_id = str(uuid.uuid4())[:8]
    room = Room(
        room_id=room_id,
        host_player_id=host_player_id,
        max_players=max_players,
        players=[host_player_id],
        status=RoomStatus.waiting,
    )
    rooms[room_id] = room
    # 广播房间创建
    asyncio.create_task(
        broadcast_to_room(
            room_id,
            {
                "type": "room_created",
                "data": {"room_id": room_id, "host": host_player_id},
            },
        )
    )
    return {"room_id": room_id, "message": "Room created"}


@app.get("/room/list")
def list_rooms():
    return [
        {
            "room_id": r.room_id,
            "host": r.host_player_id,
            "players": r.players,
            "max_players": r.max_players,
            "status": r.status,
        }
        for r in rooms.values()
        if r.status != RoomStatus.finished
    ]


@app.post("/room/{room_id}/join")
def join_room(room_id: str, player_id: str):
    if room_id not in rooms:
        raise HTTPException(404, "Room not found")
    room = rooms[room_id]
    if room.status != RoomStatus.waiting:
        raise HTTPException(400, "Cannot join: game already started")
    if player_id in room.players:
        raise HTTPException(400, "Already in room")
    if len(room.players) >= room.max_players:
        raise HTTPException(400, "Room is full")
    room.players.append(player_id)
    asyncio.create_task(
        broadcast_to_room(
            room_id,
            {
                "type": "player_joined",
                "data": {"player_id": player_id, "players": room.players},
            },
        )
    )
    return {"message": f"{player_id} joined"}


@app.post("/room/{room_id}/leave")
def leave_room(room_id: str, player_id: str):
    if room_id not in rooms:
        raise HTTPException(404, "Room not found")
    room = rooms[room_id]
    if player_id not in room.players:
        raise HTTPException(400, "Not in room")
    if room.status != RoomStatus.waiting:
        raise HTTPException(400, "Cannot leave after game started")
    room.players.remove(player_id)
    if player_id == room.host_player_id and room.players:
        room.host_player_id = room.players[0]
    if not room.players:
        del rooms[room_id]
        return {"message": "Room deleted"}
    asyncio.create_task(
        broadcast_to_room(
            room_id,
            {
                "type": "player_left",
                "data": {"player_id": player_id, "players": room.players},
            },
        )
    )
    return {"message": f"{player_id} left"}


@app.post("/room/{room_id}/start")
def start_game(room_id: str, host_player_id: str):
    if room_id not in rooms:
        raise HTTPException(404, "Room not found")
    room = rooms[room_id]
    if room.host_player_id != host_player_id:
        raise HTTPException(403, "Only host can start")
    if len(room.players) < 3:
        raise HTTPException(400, "Need at least 3 players")
    if room.status != RoomStatus.waiting:
        raise HTTPException(400, "Game already started")
    try:
        game_state = _create_game_state(room.players)
        room.game_state = game_state
        room.status = RoomStatus.active
        # 广播游戏开始
        asyncio.create_task(
            broadcast_to_room(
                room_id,
                {
                    "type": "game_started",
                    "data": {"current_player": game_state.current_player_id},
                },
            )
        )
        return {"message": "Game started"}
    except Exception as e:
        raise HTTPException(500, f"Game init failed: {e}")


@app.delete("/room/{room_id}")
def delete_room(room_id: str, requester_id: str):
    if room_id not in rooms:
        raise HTTPException(404, "Room not found")
    room = rooms[room_id]
    if room.status == RoomStatus.waiting or requester_id == room.host_player_id:
        del rooms[room_id]
        asyncio.create_task(
            broadcast_to_room(room_id, {"type": "room_deleted", "data": {}})
        )
        return {"message": "Room deleted"}
    raise HTTPException(403, "Cannot delete active room")


@app.get("/room/{room_id}")
def get_room(room_id: str):
    if room_id not in rooms:
        raise HTTPException(404, "Room not found")
    return rooms[room_id]


# ====== 游戏动作接口（添加广播）======


@app.post("/room/{room_id}/action/draw_from_deck")
def draw_from_deck(room_id: str, player_id: str):
    room = _get_active_room(room_id)
    game = room.game_state
    if game.current_player_id != player_id:
        raise HTTPException(400, "Not your turn")
    if len(game.players[player_id].hand) != 3:
        raise HTTPException(400, "Hand must have 3 cards before drawing")
    if not game.market_deck:
        raise HTTPException(400, "Deck is empty")

    cost = sum(
        1
        for mc in game.market_display
        if not game.players[player_id].has_antimonopoly[mc.company]
    )
    if game.players[player_id].money < cost:
        raise HTTPException(400, f"Need {cost} money")

    card = game.market_deck.pop()
    game.players[player_id].money -= cost
    game.players[player_id].hand.append(card)

    # 广播动作
    asyncio.create_task(
        broadcast_to_room(
            room_id,
            {
                "type": "action",
                "data": {
                    "player_id": player_id,
                    "action": "draw_from_deck",
                    "card": card,
                    "money_spent": cost,
                    "money_left": game.players[player_id].money,
                },
            },
        )
    )

    return {"drawn": card, "money_left": game.players[player_id].money}


@app.post("/room/{room_id}/action/take_from_market")
def take_from_market(room_id: str, player_id: str, card_index: int):
    room = _get_active_room(room_id)
    game = room.game_state
    if game.current_player_id != player_id:
        raise HTTPException(400, "Not your turn")
    if len(game.players[player_id].hand) != 3:
        raise HTTPException(400, "Hand must have 3 cards before taking")
    if card_index < 0 or card_index >= len(game.market_display):
        raise HTTPException(400, "Invalid card index")

    market_card = game.market_display[card_index]
    company = market_card.company

    if game.players[player_id].has_antimonopoly[company]:
        raise HTTPException(400, f"You hold anti-monopoly token for {company}")

    game.players[player_id].hand.append(company)
    coins = market_card.coins_on_top
    game.players[player_id].money += coins
    game.market_display.pop(card_index)

    asyncio.create_task(
        broadcast_to_room(
            room_id,
            {
                "type": "action",
                "data": {
                    "player_id": player_id,
                    "action": "take_from_market",
                    "company": company,
                    "coins_gained": coins,
                },
            },
        )
    )

    return {"taken": company, "coins_gained": coins}


@app.post("/room/{room_id}/action/play_card")
def play_card(
    room_id: str,
    player_id: str,
    card_company: str,
    action: Literal["invest", "to_market"],
):
    room = _get_active_room(room_id)
    game = room.game_state
    if game.current_player_id != player_id:
        raise HTTPException(400, "Not your turn")
    if card_company not in game.players[player_id].hand:
        raise HTTPException(400, "Card not in hand")

    game.players[player_id].hand.remove(card_company)

    if action == "invest":
        game.players[player_id].investments[card_company] += 1
        if game.antimonopoly_owner[card_company] is None:
            game.antimonopoly_owner[card_company] = player_id
            game.players[player_id].has_antimonopoly[card_company] = True
        _update_antimonopoly_token(game, card_company)
    elif action == "to_market":
        if game.players[player_id].has_antimonopoly[card_company]:
            raise HTTPException(400, f"Cannot put {card_company} on market")
        game.market_display.append(MarketCard(company=card_company))

    # 检查回合结束
    triggered_end = False
    if len(game.market_deck) == 0:
        _end_round(game)
        triggered_end = True
        if game.status == "game_over":
            room.status = RoomStatus.finished
            asyncio.create_task(
                broadcast_to_room(
                    room_id,
                    {
                        "type": "game_over",
                        "data": {
                            "final_scores": {
                                pid: p.score for pid, p in game.players.items()
                            },
                            "winner": max(
                                game.players.items(), key=lambda x: x[1].score
                            )[0],
                        },
                    },
                )
            )

    # 切换玩家
    if game.status != "game_over":
        player_list = list(game.players.keys())
        idx = player_list.index(game.current_player_id)
        game.current_player_id = player_list[(idx + 1) % len(player_list)]

    # 广播动作
    msg = {
        "type": "action",
        "data": {
            "player_id": player_id,
            "action": "play_card",
            "card_company": card_company,
            "play_type": action,
            "new_current_player": (
                game.current_player_id if game.status != "game_over" else None
            ),
            "round_ended": triggered_end and game.status != "game_over",
        },
    }
    asyncio.create_task(broadcast_to_room(room_id, msg))

    return {"status": "success"}


@app.get("/")
def root():
    return {"message": "Startup Tycoon with WebSocket Broadcasting"}


if __name__ == "__main__":
    from uvicorn import run

    run(app="main:app", port=8000, reload=True)
