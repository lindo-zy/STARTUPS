"""STARTUPS 在线对战后端(FastAPI)

协议约定(与前端对齐):
- 公司即卡牌面值,取值 5~10 的整数,面值 n 的公司共有 n 张卡牌。
- 玩家身份:创建/加入房间时服务端签发 uuid 令牌(token),后续所有操作需携带。
- 房间号:6 位数字邀请码。
- 实时同步:客户端连接 WS /{room_id}/{player_name}?token=xxx,
  服务端在状态变化时向每个连接推送"个性化"的 room_state
  (只包含自己的手牌,其余玩家的手牌只给数量),避免泄露牌面。

WS 消息格式:
  {"type": "room_state",  "data": <个性化房间视图>}
  {"type": "game_started","data": {"message": str}}
  {"type": "action",      "data": {"player_id": str, "message": str, ...}}
  {"type": "round_end",   "data": {"round_number": int, "standings": [...], "payouts": {...}}}
  {"type": "game_over",   "data": {"winner": str, "standings": [...]}}
  {"type": "room_deleted","data": {}}
  {"type": "kicked",      "data": {"reason": str}}

运行: cd backend_py && python main.py  (或 uvicorn main:app --port 8080)
"""

import asyncio
import os
import random
import uuid
from enum import Enum
from typing import Any, Dict, List, Literal, Optional

from fastapi import (
    FastAPI,
    HTTPException,
    Query,
    Request,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.middleware.cors import CORSMiddleware

app = FastAPI(title="Startups")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 等待期玩家断线后的移出宽限期(秒),容忍刷新页面等短暂重连
DISCONNECT_GRACE_SECONDS = float(os.environ.get("STARTUPS_DISCONNECT_GRACE", "30"))

# ====== 游戏常量(与 README 规则一致) ======
COMPANIES = [5, 6, 7, 8, 9, 10]  # 公司编号 = 卡牌面值 = 该公司卡牌总数
MIN_PLAYERS = 3
MAX_PLAYERS = 7
HAND_SIZE = 3            # 每位玩家手牌保持 3 张
START_MONEY = 10         # 起始 10 个 1 元标记
REMOVED_CARDS = 5        # 开局随机移除的卡牌数
PAYOUT_PER_SHARE = 3     # 回合结算:最大股东向小股东收取 3 元/张
RANK_POINTS = [2, 1]     # 回合金钱排名第 1/2 名加分,最后一名 -1 分
DEFAULT_TOTAL_ROUNDS = 2
MAX_TOTAL_ROUNDS = 5
MAX_NAME_LEN = 20


class Response(BaseModel):
    code: int = 200
    message: str = "success"
    data: Any = None


# ====== 数据模型 ======
class PlayerState(BaseModel):
    player_id: str
    hand: List[int] = []
    investments: Dict[int, int]
    money: int
    score: int
    has_antimonopoly: Dict[int, bool]


class MarketCard(BaseModel):
    company: int
    coins_on_top: int = 0


class GameState(BaseModel):
    game_id: str
    players: Dict[str, PlayerState]
    market_deck: List[int]
    market_display: List[MarketCard]
    removed_cards: List[int]
    current_player_id: str
    turn_phase: Literal["acquire", "play"] = "acquire"
    # 当前玩家本回合刚从市场拿走的公司编号(该回合内不能把同公司手牌再放到市场)
    took_from_market_company: Optional[int] = None
    round_number: int = 1
    total_rounds: int = DEFAULT_TOTAL_ROUNDS
    status: Literal["active", "round_end", "game_over"] = "active"
    antimonopoly_owner: Dict[int, Optional[str]]


class RoomStatus(str, Enum):
    waiting = "waiting"
    active = "active"
    finished = "finished"


class RoomPlayer(BaseModel):
    name: str
    seat: int
    token: str
    ready: bool = False


class Room(BaseModel):
    room_id: str
    host_player_name: str
    max_players: int = MAX_PLAYERS
    players: Dict[str, RoomPlayer]  # 按加入顺序排列,seat 从 1 开始
    status: RoomStatus = RoomStatus.waiting
    game_state: Optional[GameState] = None
    # name -> 最近一次 WS 在线状态;从未连接过的玩家不在字典中
    # (用于区分"连接后掉线"与"尚未连接",只有前者允许顶替/阻断开局)
    connected: Dict[str, bool] = {}


# ====== 全局状态(内存存储,适合小局;路由均为 async,单循环内无竞态) ======
rooms: Dict[str, Room] = {}
# room_id -> {WebSocket: player_name},用于给每个连接发送个性化视图
connections: Dict[str, Dict[WebSocket, str]] = {}
# (room_id, player_name) -> 断线宽限移出任务,重连时取消
pending_removals: Dict[tuple, asyncio.Task] = {}


def _player_online(room_id: str, player_name: str) -> bool:
    return any(
        name == player_name for name in connections.get(room_id, {}).values()
    )


async def _delayed_disconnect_leave(room_id: str, player_name: str):
    """等待期玩家断线后的宽限移出:到期仍未重连则移出房间(房主则解散)。"""
    try:
        await asyncio.sleep(DISCONNECT_GRACE_SECONDS)
    except asyncio.CancelledError:
        return
    pending_removals.pop((room_id, player_name), None)
    room = rooms.get(room_id)
    if room is None or room.status is not RoomStatus.waiting:
        return
    if player_name not in room.players or _player_online(room_id, player_name):
        return
    if player_name == room.host_player_name:
        rooms.pop(room_id, None)
        await _broadcast_event(room_id, "room_deleted", {"reason": "房主已离开,房间解散"})
        return
    room.players.pop(player_name, None)
    room.connected.pop(player_name, None)
    await _push(room)


# ====== 通用工具 ======
def _new_token() -> str:
    return uuid.uuid4().hex


def _gen_room_id() -> str:
    """生成未占用的 6 位数字邀请码。"""
    while True:
        room_id = f"{random.randint(0, 999999):06d}"
        if room_id not in rooms:
            return room_id


def _check_name(player_name: str) -> str:
    name = (player_name or "").strip()
    if not name:
        raise HTTPException(400, "请填写昵称")
    if len(name) > MAX_NAME_LEN:
        raise HTTPException(400, f"昵称最长 {MAX_NAME_LEN} 个字符")
    return name


def _get_room(room_id: str) -> Room:
    room = rooms.get(room_id)
    if room is None:
        raise HTTPException(404, "房间不存在或已解散")
    return room


def _get_active_room(room_id: str) -> Room:
    room = _get_room(room_id)
    if room.status != RoomStatus.active or room.game_state is None:
        raise HTTPException(400, "游戏未在进行中")
    return room


def _auth(room: Room, player_name: str, token: str) -> RoomPlayer:
    rp = room.players.get(player_name)
    if rp is None:
        raise HTTPException(403, "你不在该房间中")
    if not token or token != rp.token:
        raise HTTPException(403, "身份校验失败,请重新加入房间")
    return rp


def _shuffle_deck() -> List[int]:
    deck = [company for company in COMPANIES for _ in range(company)]
    random.shuffle(deck)
    return deck


# ====== 游戏引擎 ======
def _create_game_state(player_names: List[str], total_rounds: int) -> GameState:
    deck = _shuffle_deck()
    removed = [deck.pop() for _ in range(REMOVED_CARDS)]
    players = {
        name: PlayerState(
            player_id=name,
            hand=[deck.pop() for _ in range(HAND_SIZE)],
            investments={c: 0 for c in COMPANIES},
            money=START_MONEY,
            score=0,
            has_antimonopoly={c: False for c in COMPANIES},
        )
        for name in player_names
    }
    return GameState(
        game_id=uuid.uuid4().hex[:8],
        players=players,
        market_deck=deck,
        market_display=[],
        removed_cards=removed,
        current_player_id=player_names[0],
        antimonopoly_owner={c: None for c in COMPANIES},
        total_rounds=total_rounds,
    )


def _draw_cost(game: GameState, player: PlayerState) -> int:
    """从牌库抽牌需向市场中每张已公开卡牌支付 1 元;
    持有某公司反垄断标记时,无需为该公司的市场卡付费。"""
    return sum(
        1 for mc in game.market_display if not player.has_antimonopoly[mc.company]
    )


def _can_take_from_market(game: GameState, player: PlayerState) -> bool:
    return any(not player.has_antimonopoly[mc.company] for mc in game.market_display)


def _transfer_antimonopoly(game: GameState, company: int):
    """反垄断标记仅在有人持股【严格超过】当前持有者时转移(README 规则)。"""
    owner = game.antimonopoly_owner[company]
    if owner is None:
        return
    owner_count = game.players[owner].investments[company]
    challengers = {
        pid: p.investments[company]
        for pid, p in game.players.items()
        if pid != owner and p.investments[company] > owner_count
    }
    if challengers:
        new_owner = max(challengers, key=lambda pid: challengers[pid])
        game.players[owner].has_antimonopoly[company] = False
        game.antimonopoly_owner[company] = new_owner
        game.players[new_owner].has_antimonopoly[company] = True


def _invest(game: GameState, player_name: str, company: int):
    player = game.players[player_name]
    player.investments[company] += 1
    if game.antimonopoly_owner[company] is None:
        # 第一个投资该公司的玩家获得反垄断标记
        game.antimonopoly_owner[company] = player_name
        player.has_antimonopoly[company] = True
    else:
        _transfer_antimonopoly(game, company)


def _end_round(game: GameState) -> dict:
    """回合结算:手牌自动投资 -> 最大股东收钱 -> 按金钱排名加分。"""
    # 1. 所有玩家手牌自动视为已投资
    for player in game.players.values():
        for company in player.hand:
            player.investments[company] += 1
        player.hand = []

    # 2. 持股变化后重新校验反垄断标记归属
    for company in COMPANIES:
        _transfer_antimonopoly(game, company)

    # 3. 每家公司:唯一最大股东向其他小股东收取 3 元/张;
    #    并列最多则无人收益;付款不足者记为负资产(金钱可变负)。
    payouts: Dict[str, dict] = {}
    for company in COMPANIES:
        holdings = [(pid, p.investments[company]) for pid, p in game.players.items()]
        max_holding = max(h for _, h in holdings)
        if max_holding == 0:
            continue
        leaders = [pid for pid, h in holdings if h == max_holding]
        if len(leaders) != 1:
            continue
        major = leaders[0]
        for pid, shares in holdings:
            if pid == major or shares == 0:
                continue
            owed = shares * PAYOUT_PER_SHARE
            game.players[pid].money -= owed
            game.players[major].money += owed
            payouts.setdefault(str(company), {"major": major, "paid": {}})
            payouts[str(company)]["paid"][pid] = owed

    # 4. 按本轮总金钱排名加分(+2/+1/-1),金钱相同按座位顺序
    order = list(game.players.keys())
    ranked = sorted(order, key=lambda pid: (-game.players[pid].money, order.index(pid)))
    deltas = {pid: 0 for pid in order}
    if len(ranked) >= 2:
        deltas[ranked[0]] += RANK_POINTS[0]
        deltas[ranked[1]] += RANK_POINTS[1]
        deltas[ranked[-1]] -= 1
        for pid, delta in deltas.items():
            game.players[pid].score += delta

    standings = [
        {
            "rank": i + 1,
            "player_id": pid,
            "money": game.players[pid].money,
            "score": game.players[pid].score,
            "score_delta": deltas[pid],
        }
        for i, pid in enumerate(ranked)
    ]
    return {"round_number": game.round_number, "standings": standings, "payouts": payouts}


def _advance_after_round(room: Room, game: GameState) -> bool:
    """返回 True 表示开启了下一轮;False 表示游戏结束。"""
    if game.round_number >= game.total_rounds:
        game.status = "game_over"
        room.status = RoomStatus.finished
        return False
    # 下一轮:重建牌库(同样移除开局那 5 张),重新发 3 张手牌;
    # 投资组合、金钱、分数跨轮保留。
    deck = _shuffle_deck()
    for card in game.removed_cards:
        deck.remove(card)
    game.market_deck = deck
    game.market_display = []
    for player in game.players.values():
        player.hand = [deck.pop() for _ in range(HAND_SIZE)]
    game.round_number += 1
    game.current_player_id = list(game.players.keys())[0]
    game.turn_phase = "acquire"
    game.took_from_market_company = None
    return True


def _final_standings(game: GameState) -> List[dict]:
    order = list(game.players.keys())
    ranked = sorted(order, key=lambda pid: (-game.players[pid].score, order.index(pid)))
    return [
        {
            "rank": i + 1,
            "player_id": pid,
            "score": game.players[pid].score,
            "money": game.players[pid].money,
        }
        for i, pid in enumerate(ranked)
    ]


# ====== 视图与广播(个性化:只暴露自己的手牌) ======
def _public_player(room: Room, name: str) -> dict:
    rp = room.players[name]
    entry: Dict[str, Any] = {
        "name": name,
        "seat": rp.seat,
        "ready": rp.ready,
        "is_host": name == room.host_player_name,
        # 仅"连接后掉线"视为离线;从未连接(刚加入/纯 HTTP)不标离线
        "online": room.connected.get(name) is not False,
    }
    game = room.game_state
    if game:
        p = game.players[name]
        entry.update(
            {
                "money": p.money,
                "score": p.score,
                "investments": p.investments,
                "antimonopoly": p.has_antimonopoly,
                "hand_count": len(p.hand),
            }
        )
    return entry


def _view_for(room: Room, viewer: Optional[str]) -> dict:
    """viewer=None 时返回不含任何手牌的公共视图(用于 HTTP 查询)。"""
    view: Dict[str, Any] = {
        "room_id": room.room_id,
        "host": room.host_player_name,
        "max_players": room.max_players,
        "status": room.status.value,
        "players": [_public_player(room, name) for name in room.players],
    }
    game = room.game_state
    if game:
        view.update(
            {
                "round_number": game.round_number,
                "total_rounds": game.total_rounds,
                "current_player": game.current_player_id,
                "turn_phase": game.turn_phase,
                "took_from_market_company": game.took_from_market_company,
                "game_status": game.status,
                "deck_count": len(game.market_deck),
                "removed_count": len(game.removed_cards),
                "market": [mc.model_dump() for mc in game.market_display],
                "antimonopoly_owner": game.antimonopoly_owner,
            }
        )
        if viewer and viewer in game.players:
            mine = next(e for e in view["players"] if e["name"] == viewer)
            mine["hand"] = game.players[viewer].hand
    return view


async def _broadcast_state(room: Room):
    conns = connections.get(room.room_id)
    if not conns:
        return
    stale = []
    for ws, name in list(conns.items()):
        try:
            await ws.send_json({"type": "room_state", "data": _view_for(room, name)})
        except Exception:
            stale.append(ws)
    for ws in stale:
        conns.pop(ws, None)


async def _broadcast_event(room_id: str, mtype: str, data: dict):
    conns = connections.get(room_id)
    if not conns:
        return
    stale = []
    for ws in list(conns):
        try:
            await ws.send_json({"type": mtype, "data": data})
        except Exception:
            stale.append(ws)
    for ws in stale:
        conns.pop(ws, None)


async def _push(room: Room, events: Optional[List[tuple]] = None):
    """先同步最新状态,再推送事件(操作日志/结算/结束)。"""
    await _broadcast_state(room)
    for mtype, data in events or []:
        await _broadcast_event(room.room_id, mtype, data)


# ====== 统一错误响应(前端拦截器按 code/message 处理) ======
@app.exception_handler(HTTPException)
async def _http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.status_code, "message": exc.detail, "data": None},
    )


@app.exception_handler(RequestValidationError)
async def _validation_exception_handler(request: Request, exc: RequestValidationError):
    first = exc.errors()[0] if exc.errors() else {}
    loc = ".".join(str(x) for x in first.get("loc", [])[1:])
    return JSONResponse(
        status_code=422,
        content={"code": 422, "message": f"参数错误: {loc} {first.get('msg', '')}", "data": None},
    )


# ====== WebSocket ======
@app.websocket("/{room_id}/{player_name}")
async def websocket_endpoint(
    websocket: WebSocket,
    room_id: str,
    player_name: str,
    token: str = Query(default=""),
):
    await websocket.accept()
    room = rooms.get(room_id)
    rp = room.players.get(player_name) if room else None
    if rp is None or not token or token != rp.token:
        await websocket.close(code=1008, reason="身份校验失败或已不在房间中")
        return

    connections.setdefault(room_id, {})[websocket] = player_name
    # 掉线后重连(此前被标记为离线):注册连接后广播,让其他玩家立即撤下"离线"标记
    back_online = room.connected.get(player_name) is False
    room.connected[player_name] = True
    # 重连:取消待执行的断线移出
    pending = pending_removals.pop((room_id, player_name), None)
    if pending is not None:
        pending.cancel()
    try:
        # 连接即推送当前个性化状态(支持刷新页面后恢复)
        await websocket.send_json(
            {"type": "room_state", "data": _view_for(room, player_name)}
        )
        if back_online:
            await _push(room)
        while True:
            # 客户端发送任意上行消息(如页面挂载后的 "sync")都会触发
            # 重发当前个性化状态,避免初始推送与监听器挂载之间的竞态丢消息
            await websocket.receive_text()
            room = rooms.get(room_id)
            if room:
                await websocket.send_json(
                    {"type": "room_state", "data": _view_for(room, player_name)}
                )
    except WebSocketDisconnect:
        pass
    finally:
        conns = connections.get(room_id)
        if conns is not None:
            conns.pop(websocket, None)
            if not conns:
                connections.pop(room_id, None)
        room = rooms.get(room_id)
        if room is not None and player_name in room.players:
            # 记录该玩家最近一次 WS 在线状态(多开标签页时任一连接存活即在线)
            room.connected[player_name] = _player_online(room_id, player_name)
            if not room.connected[player_name]:
                # 广播"已断开",其他玩家立即看到离线标记(对局中掉线凭昵称+房间号可重进)
                # 等待期同时进入宽限期,到期仍未重连则自动移出房间(房主则解散房间)
                if room.status is RoomStatus.waiting:
                    pending_removals[(room_id, player_name)] = asyncio.create_task(
                        _delayed_disconnect_leave(room_id, player_name)
                    )
                await _push(room)


# ====== 房间接口 ======
@app.post("/room/create")
async def create_room(player_name: str):
    name = _check_name(player_name)
    room = Room(
        room_id=_gen_room_id(),
        host_player_name=name,
        players={name: RoomPlayer(name=name, seat=1, token=_new_token(), ready=True)},
    )
    rooms[room.room_id] = room
    rp = room.players[name]
    return Response(data={"room_id": room.room_id, "token": rp.token, "seat": rp.seat})


@app.post("/room/join")
async def join_room(room_id: str, player_name: str):
    name = _check_name(player_name)
    room = _get_room(room_id)
    if name in room.players:
        rp = room.players[name]
        if room.status is RoomStatus.waiting:
            if room.connected.get(name) is not False:
                # 在线,或从未连接过(刚加入、正在握手)——不允许顶替
                raise HTTPException(400, f"昵称「{name}」已在房间中,请换一个昵称")
            # 等待期同名玩家确认已断线:允许顶替其座位重新加入。
            # 复用原令牌而不是换发,避免原客户端(如只是网络抖动、
            # 或用旧标签页再进)的令牌被静默作废后点任何操作都报
            # "身份校验失败";两个端持有同一令牌时视为同一座位。
            room.connected.pop(name, None)
        else:
            # 对局进行中/已结束:座位保留,玩家凭"昵称+房间号"即可重进,
            # 恢复自己的手牌/投资继续游戏(或查看终局),避免一局因掉线卡死。
            # 在线判定以存活 WS 连接为准;新人仍不能在对局中途加入。
            if _player_online(room_id, name):
                raise HTTPException(400, f"昵称「{name}」已在房间中,请换一个昵称")
        # 若正处于断线宽限期,取消其待执行的自动移出
        pending = pending_removals.pop((room_id, name), None)
        if pending is not None:
            pending.cancel()
        await _push(room)
        return Response(data={"room_id": room.room_id, "token": rp.token, "seat": rp.seat})
    if room.status != RoomStatus.waiting:
        raise HTTPException(400, "游戏已开始或已结束,无法加入")
    if len(room.players) >= room.max_players:
        raise HTTPException(400, "房间已满")
    rp = RoomPlayer(name=name, seat=len(room.players) + 1, token=_new_token())
    room.players[name] = rp
    await _push(room)
    return Response(data={"room_id": room.room_id, "token": rp.token, "seat": rp.seat})


@app.post("/room/ready")
async def ready_room(room_id: str, player_name: str, token: str, ready: bool = True):
    room = _get_room(room_id)
    rp = _auth(room, player_name, token)
    if room.status != RoomStatus.waiting:
        raise HTTPException(400, "游戏已开始,无法更改准备状态")
    if player_name == room.host_player_name:
        raise HTTPException(400, "房主无需准备")
    rp.ready = ready
    await _push(room)
    return Response(data=_view_for(room, player_name))


@app.post("/room/leave")
async def leave_room(room_id: str, player_name: str, token: str):
    room = _get_room(room_id)
    _auth(room, player_name, token)
    is_host = player_name == room.host_player_name

    if is_host:
        # 房主离开/退出 => 房间解散(README 流程第 4 条)
        rooms.pop(room_id, None)
        await _broadcast_event(room_id, "room_deleted", {"reason": "房主已解散房间"})
        return Response(data=None)

    if room.status != RoomStatus.waiting:
        raise HTTPException(400, "游戏进行中无法退出,请等待本局结束")
    room.players.pop(player_name, None)
    room.connected.pop(player_name, None)
    await _push(room)
    return Response(data=None)


async def _kick_connections(room_id: str, player_name: str, reason: str):
    """向目标玩家的所有 WS 连接推送 kicked 事件并断开。"""
    conns = connections.get(room_id)
    if not conns:
        return
    targets = [ws for ws, name in conns.items() if name == player_name]
    for ws in targets:
        try:
            await ws.send_json({"type": "kicked", "data": {"reason": reason}})
        except Exception:
            pass
        conns.pop(ws, None)
        try:
            await ws.close(code=1000, reason=reason)
        except Exception:
            pass


@app.post("/room/kick")
async def kick_player(
    room_id: str,
    player_name: str,
    token: str,
    target_player_name: str = Query(...),
):
    """房主将一名玩家移出房间(仅等待期)。"""
    room = _get_room(room_id)
    _auth(room, player_name, token)
    if player_name != room.host_player_name:
        raise HTTPException(403, "只有房主可以移出玩家")
    if target_player_name == player_name:
        raise HTTPException(400, "不能移出自己(房主离开会解散房间)")
    if target_player_name not in room.players:
        raise HTTPException(404, "该玩家不在房间中")
    if room.status != RoomStatus.waiting:
        raise HTTPException(400, "游戏进行中无法移出玩家,请等待本局结束")
    # 若目标正处于断线宽限期,取消其待执行的自动移出,立即生效
    pending = pending_removals.pop((room_id, target_player_name), None)
    if pending is not None:
        pending.cancel()
    room.players.pop(target_player_name, None)
    room.connected.pop(target_player_name, None)
    # 先断开被踢者的连接并推送 kicked,再向剩余玩家广播新状态
    await _kick_connections(room_id, target_player_name, "你已被房主移出房间")
    await _push(room)
    return Response(data=_view_for(room, player_name))


@app.delete("/room/delete")
async def delete_room(room_id: str, player_name: str, token: str):
    room = _get_room(room_id)
    _auth(room, player_name, token)
    if player_name != room.host_player_name:
        raise HTTPException(403, "只有房主可以解散房间")
    rooms.pop(room_id, None)
    await _broadcast_event(room_id, "room_deleted", {"reason": "房主已解散房间"})
    return Response(data=None)


@app.get("/room/list")
def list_rooms():
    data = [
        {
            "room_id": r.room_id,
            "host": r.host_player_name,
            "player_count": len(r.players),
            "max_players": r.max_players,
            "status": r.status.value,
        }
        for r in rooms.values()
        if r.status != RoomStatus.finished
    ]
    return Response(data=data)


@app.get("/room/{room_id}")
def get_room(room_id: str):
    """公共房间信息(不含任何手牌)。"""
    room = _get_room(room_id)
    return Response(data=_view_for(room, viewer=None))


@app.post("/room/start")
async def start_game(
    room_id: str,
    player_name: str,
    token: str,
    total_rounds: int = Query(default=DEFAULT_TOTAL_ROUNDS, ge=2, le=MAX_TOTAL_ROUNDS),
):
    room = _get_room(room_id)
    _auth(room, player_name, token)
    if player_name != room.host_player_name:
        raise HTTPException(403, "只有房主可以开始游戏")
    if room.status != RoomStatus.waiting:
        raise HTTPException(400, "游戏已开始或已结束")
    if len(room.players) < MIN_PLAYERS:
        raise HTTPException(400, f"至少需要 {MIN_PLAYERS} 名玩家")
    if len(room.players) > MAX_PLAYERS:
        raise HTTPException(400, f"最多 {MAX_PLAYERS} 名玩家")
    not_ready = [
        name
        for name, rp in room.players.items()
        if name != room.host_player_name
        and (not rp.ready or room.connected.get(name) is False)
    ]
    if not_ready:
        raise HTTPException(400, f"还有玩家未准备或已离线: {'、'.join(not_ready)}")

    room.game_state = _create_game_state(list(room.players.keys()), total_rounds)
    room.status = RoomStatus.active
    await _push(room, [("game_started", {"message": "游戏开始,祝你好运!"})])
    return Response(data=_view_for(room, player_name))


# ====== 游戏动作接口 ======
def _assert_my_turn(game: GameState, player_name: str):
    if game.current_player_id != player_name:
        raise HTTPException(400, "还没轮到你操作")


@app.post("/room/action/draw")
async def draw_from_deck(room_id: str, player_name: str, token: str):
    room = _get_active_room(room_id)
    _auth(room, player_name, token)
    game = room.game_state
    _assert_my_turn(game, player_name)
    if game.turn_phase != "acquire":
        raise HTTPException(400, "本回合已经获取过卡牌,请打出一张手牌")
    player = game.players[player_name]
    if not game.market_deck:
        raise HTTPException(400, "牌库已空,请从市场拿牌")
    cost = _draw_cost(game, player)
    # 资金不足但市场无牌可拿时,允许免费抽牌(兜底规则,保证手牌始终为 3 张)
    forced_free = cost > 0 and player.money < cost and not _can_take_from_market(game, player)
    if cost > 0 and player.money < cost and not forced_free:
        raise HTTPException(400, f"金钱不足,抽牌需要支付 {cost} 元,可尝试从市场拿牌")

    card = game.market_deck.pop()
    if not forced_free:
        player.money -= cost
        # 支付的 1 元逐张放到市场已公开的卡牌上(反垄断豁免的公司除外)
        for mc in game.market_display:
            if not player.has_antimonopoly[mc.company]:
                mc.coins_on_top += 1
    player.hand.append(card)
    game.turn_phase = "play"

    if forced_free:
        cost_note = "(资金不足,免费抽牌)"
    elif cost > 0:
        cost_note = f"(支付 {cost} 元)"
    else:
        cost_note = "(免费)"
    await _push(
        room,
        [
            (
                "action",
                {
                    "player_id": player_name,
                    "action": "draw_from_deck",
                    "message": f"{player_name} 从牌库抽了一张牌{cost_note}",
                },
            )
        ],
    )
    return Response(data=_view_for(room, player_name))


@app.post("/room/action/take")
async def take_from_market(room_id: str, player_name: str, token: str, card_index: int):
    room = _get_active_room(room_id)
    _auth(room, player_name, token)
    game = room.game_state
    _assert_my_turn(game, player_name)
    if game.turn_phase != "acquire":
        raise HTTPException(400, "本回合已经获取过卡牌,请打出一张手牌")
    if card_index < 0 or card_index >= len(game.market_display):
        raise HTTPException(400, "无效的市场卡牌")
    player = game.players[player_name]
    market_card = game.market_display[card_index]
    if player.has_antimonopoly[market_card.company]:
        raise HTTPException(
            400, f"你持有公司 {market_card.company} 的反垄断标记,不能从市场拿取该公司卡牌"
        )

    player.hand.append(market_card.company)
    player.money += market_card.coins_on_top
    game.market_display.pop(card_index)
    game.took_from_market_company = market_card.company
    game.turn_phase = "play"

    await _push(
        room,
        [
            (
                "action",
                {
                    "player_id": player_name,
                    "action": "take_from_market",
                    "message": (
                        f"{player_name} 从市场拿走公司 {market_card.company} 的卡牌"
                        + (f"(获得 {market_card.coins_on_top} 元)" if market_card.coins_on_top else "")
                    ),
                },
            )
        ],
    )
    return Response(data=_view_for(room, player_name))


@app.post("/room/action/play")
async def play_card(
    room_id: str,
    player_name: str,
    token: str,
    card_company: int,
    action: Literal["invest", "to_market"],
):
    room = _get_active_room(room_id)
    _auth(room, player_name, token)
    game = room.game_state
    _assert_my_turn(game, player_name)
    player = game.players[player_name]
    if card_company not in player.hand:
        raise HTTPException(400, f"手牌中没有公司 {card_company} 的卡牌")
    # 牌库非空时抽牌端点必定可行(必要时免费兜底);因此仅当
    # 牌库已空且市场无牌可拿时,才允许跳过"获取"直接出牌(之后回合即结束)。
    if game.turn_phase != "play" and (game.market_deck or _can_take_from_market(game, player)):
        raise HTTPException(400, "请先抽牌或从市场拿牌")
    if action == "to_market" and player.has_antimonopoly[card_company]:
        raise HTTPException(
            400, f"你持有公司 {card_company} 的反垄断标记,不能把该公司卡牌打到市场"
        )
    if action == "to_market" and game.took_from_market_company == card_company:
        raise HTTPException(
            400,
            f"公司 {card_company} 的卡牌是你本回合刚从市场拿回的,不能再打到市场,可选择投资或打出其他手牌",
        )

    player.hand.remove(card_company)
    if action == "invest":
        _invest(game, player_name, card_company)
    else:
        game.market_display.append(MarketCard(company=card_company))

    events: List[tuple] = [
        (
            "action",
            {
                "player_id": player_name,
                "action": "play_card",
                "message": (
                    f"{player_name} 投资了公司 {card_company}"
                    if action == "invest"
                    else f"{player_name} 把公司 {card_company} 的卡牌放到了市场"
                ),
            },
        )
    ]

    # 牌库抽完且当前玩家打出卡牌 => 回合结束
    if not game.market_deck:
        summary = _end_round(game)
        events.append(("round_end", summary))
        if not _advance_after_round(room, game):
            standings = _final_standings(game)
            winner = standings[0]["player_id"]
            events.append(
                (
                    "game_over",
                    {
                        "winner": winner,
                        "total_rounds": game.total_rounds,
                        "standings": standings,
                    },
                )
            )
    else:
        # 轮到下一位玩家
        player_list = list(game.players.keys())
        idx = player_list.index(game.current_player_id)
        game.current_player_id = player_list[(idx + 1) % len(player_list)]
        game.turn_phase = "acquire"
        game.took_from_market_company = None

    await _push(room, events)
    return Response(data=_view_for(room, player_name))


@app.get("/")
def root():
    return "STARTUPS 服务启动成功"


if __name__ == "__main__":
    from uvicorn import run

    run(app="main:app", host="0.0.0.0", port=8080)
