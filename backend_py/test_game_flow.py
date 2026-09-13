"""后端集成测试:模拟 3 名玩家通过 HTTP + WebSocket 走完一整局游戏。

覆盖:
- 房间创建/加入/昵称重复校验/房主解散
- 准备机制与开始游戏校验
- 回合流程(抽牌付费金币上卡、市场拿牌收钱、投资/上架)
- 刚从市场拿回的卡牌同回合不能再次上架(投资不受限,抽牌不触发)
- 回合结算与两轮后游戏结束
- WebSocket 个性化广播不泄露他人手牌/牌库/暗牌
- 令牌鉴权与回合校验
- 断线宽限/同名重入令牌复用/房主移出玩家(kick)
- 对局中掉线:立即广播离线,同名玩家凭昵称+房间号重进恢复座位继续游戏,
  新玩家不能中途加入

运行: cd backend_py && python3 test_game_flow.py
"""

import asyncio
import json
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import quote

import httpx
import websockets

BASE = "http://127.0.0.1:8765"
WS_BASE = "ws://127.0.0.1:8765"
COMPANIES = [5, 6, 7, 8, 9, 10]

failures = []


def check(cond, label):
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {label}")
    if not cond:
        failures.append(label)


def http(method, path, params=None):
    with httpx.Client(base_url=BASE, timeout=10) as client:
        resp = client.request(method, path, params=params)
    try:
        body = resp.json()
    except Exception:
        body = {}
    return resp.status_code, body


class WsListener:
    """后台线程收集某玩家的全部 WS 消息。"""

    def __init__(self, room_id, name, token):
        self.url = f"{WS_BASE}/{room_id}/{quote(name)}?token={token}"
        self.messages = []
        self.error = None
        self._stop_flag = False
        self._thread = threading.Thread(target=lambda: asyncio.run(self._run()), daemon=True)

    async def _run(self):
        try:
            async with websockets.connect(self.url) as ws:
                while not self._stop_flag:
                    try:
                        msg = await asyncio.wait_for(ws.recv(), timeout=0.2)
                        self.messages.append(json.loads(msg))
                    except asyncio.TimeoutError:
                        continue
        except Exception as e:  # noqa: BLE001
            if not self._stop_flag:
                self.error = e

    def start(self):
        self._thread.start()

    def stop(self):
        self._stop_flag = True
        self._thread.join(timeout=3)

    def by_type(self, mtype):
        return [m for m in self.messages if m.get("type") == mtype]


def main():
    # ---------- 房间创建与加入 ----------
    code, body = http("POST", "/room/create", {"player_name": "小明"})
    check(code == 200 and body["data"]["room_id"], "房主创建房间成功")
    room_id = body["data"]["room_id"]
    check(len(room_id) == 6 and room_id.isdigit(), "房间号是 6 位数字邀请码")
    tok_a = body["data"]["token"]

    code, body = http("POST", "/room/join", {"room_id": room_id, "player_name": "小红"})
    tok_b = body["data"]["token"]
    check(code == 200, "玩家B加入房间")
    code, body = http("POST", "/room/join", {"room_id": room_id, "player_name": "小刚"})
    tok_c = body["data"]["token"]
    check(code == 200, "玩家C加入房间")

    code, body = http("POST", "/room/join", {"room_id": room_id, "player_name": "小红"})
    check(code == 400, "重复昵称被拒绝")

    code, body = http("POST", "/room/join", {"room_id": "000000", "player_name": "路人"})
    check(code == 404, "不存在的房间返回 404")

    # 房主提前开始应被拒绝(有人未准备)
    code, body = http("POST", "/room/start", {"room_id": room_id, "player_name": "小明", "token": tok_a})
    check(code == 400, "有玩家未准备时不能开始游戏")

    # ---------- WS 连接(开始游戏前建立,收集全程消息) ----------
    listeners = {
        name: WsListener(room_id, name, tok)
        for name, tok in [("小明", tok_a), ("小红", tok_b), ("小刚", tok_c)]
    }
    for l in listeners.values():
        l.start()
    time.sleep(0.8)  # 等待连接建立并收到初始 room_state

    # 令牌错误应被拒绝
    bad = WsListener(room_id, "小明", "wrong-token")
    bad.start()
    time.sleep(0.6)
    bad.stop()
    check(bad.error is not None or not bad.messages, "错误令牌的 WS 连接被拒绝")

    # ---------- 准备与开始 ----------
    code, body = http("POST", "/room/ready", {"room_id": room_id, "player_name": "小红", "token": tok_b})
    check(code == 200, "玩家B准备")
    code, body = http("POST", "/room/ready", {"room_id": room_id, "player_name": "小刚", "token": tok_c})
    check(code == 200, "玩家C准备")

    code, body = http(
        "POST", "/room/start",
        {"room_id": room_id, "player_name": "小刚", "token": tok_c},
    )
    check(code == 403, "非房主不能开始游戏")

    code, body = http(
        "POST", "/room/start",
        {"room_id": room_id, "player_name": "小明", "token": tok_a, "total_rounds": 2},
    )
    check(code == 200 and body["data"]["game_status"] == "active", "房主开始游戏(2轮)")
    check(body["data"]["deck_count"] == 31, f"牌库数量 45-5-9=31 (实际 {body['data']['deck_count']})")
    check(len(body["data"]["players"][0]["hand"]) == 3, "房主视角能看到自己 3 张手牌")

    # ---------- 泄露检查:任何 room_state 不得包含他人手牌/牌库/暗牌 ----------
    def leak_scan(listener, owner):
        bad_keys = []
        for m in listener.messages:
            if m.get("type") != "room_state":
                continue
            data = m["data"]
            if "market_deck" in data or "removed_cards" in data:
                bad_keys.append(f"{owner}: 顶层泄露牌库/暗牌")
            for p in data.get("players", []):
                if "hand" in p and p["name"] != owner:
                    bad_keys.append(f"{owner}: 泄露了 {p['name']} 的手牌")
        return bad_keys

    time.sleep(0.8)
    for name, l in listeners.items():
        states = l.by_type("room_state")
        check(
            any("deck_count" in m["data"] for m in states),
            f"{name} 收到 {len(states)} 条 room_state(含游戏状态)",
        )
    leaks = []
    for name, l in listeners.items():
        leaks += leak_scan(l, name)
    check(not leaks, f"广播未泄露手牌/牌库/暗牌 {leaks[:3]}")

    # ---------- 回合校验 ----------
    code, body = http(
        "POST", "/room/action/play",
        {"room_id": room_id, "player_name": "小明", "token": tok_a, "card_company": 5, "action": "invest"},
    )
    check(code == 400, "未获取卡牌前不能直接出牌")

    code, body = http(
        "POST", "/room/action/draw",
        {"room_id": room_id, "player_name": "小红", "token": tok_b},
    )
    check(code == 400, "未轮到玩家B时不能抽牌")

    code, body = http(
        "POST", "/room/action/draw",
        {"room_id": room_id, "player_name": "小明", "token": "bad-token"},
    )
    check(code == 403, "错误令牌的操作被拒绝")

    # ---------- 规则:刚从市场拿回的卡牌,同回合不能再次上架 ----------
    # 小明抽牌后先打一张到市场 -> 小红把该牌拿回 -> 小红尝试再上架应被拒绝(投资不受限)
    code, body = http(
        "POST", "/room/action/draw", {"room_id": room_id, "player_name": "小明", "token": tok_a}
    )
    check(code == 200, "小明抽牌进入出牌阶段")
    hand_a = next(p for p in body["data"]["players"] if p["name"] == "小明")["hand"]
    card_x = hand_a[0]
    code, body = http(
        "POST", "/room/action/play",
        {"room_id": room_id, "player_name": "小明", "token": tok_a,
         "card_company": card_x, "action": "to_market"},
    )
    check(code == 200, f"小明抽牌后上架公司 {card_x} 不受限(抽牌不触发该规则)")

    code, body = http(
        "POST", "/room/action/take",
        {"room_id": room_id, "player_name": "小红", "token": tok_b, "card_index": 0},
    )
    check(code == 200, "小红从市场拿回该卡牌")
    check(
        body["data"].get("took_from_market_company") == card_x,
        "视图标记了刚从市场拿回的公司",
    )

    code, body = http(
        "POST", "/room/action/play",
        {"room_id": room_id, "player_name": "小红", "token": tok_b,
         "card_company": card_x, "action": "to_market"},
    )
    check(
        code == 400 and "刚从市场拿回" in body.get("message", ""),
        "刚拿回的卡牌同回合再上架被拒绝(400)",
    )

    code, body = http(
        "POST", "/room/action/play",
        {"room_id": room_id, "player_name": "小红", "token": tok_b,
         "card_company": card_x, "action": "invest"},
    )
    check(code == 200, "刚拿回的卡牌可以选择投资")

    # 小刚走抽牌路线,验证限制只针对"从市场拿回"的牌
    code, body = http(
        "POST", "/room/action/draw", {"room_id": room_id, "player_name": "小刚", "token": tok_c}
    )
    check(code == 200, "小刚抽牌进入出牌阶段")
    card_c = next(p for p in body["data"]["players"] if p["name"] == "小刚")["hand"][0]
    code, body = http(
        "POST", "/room/action/play",
        {"room_id": room_id, "player_name": "小刚", "token": tok_c,
         "card_company": card_c, "action": "to_market"},
    )
    check(code == 200, "小刚抽牌后上架不受限")

    # ---------- 自动对局:轮流 获取->打出(全投资),直到游戏结束 ----------
    def public_view():
        _, body = http("GET", f"/room/{room_id}")
        return body["data"]

    def try_act(name, tok, view):
        me = next(p for p in view["players"] if p["name"] == name)
        blocked = {int(k) for k, v in (me.get("antimonopoly") or {}).items() if v}
        if view["turn_phase"] == "acquire":
            cost = sum(1 for m in view["market"] if m["company"] not in blocked)
            affordable = cost == 0 or me["money"] >= cost
            # 免费抽牌兜底(资金不足且市场无牌可拿)
            forced_free = not affordable and not any(
                m["company"] not in blocked for m in view["market"]
            )
            if view["deck_count"] > 0 and (affordable or forced_free):
                code, _ = http("POST", "/room/action/draw", {"room_id": room_id, "player_name": name, "token": tok})
                if code == 200:
                    return True
            idx = next(
                (i for i, m in enumerate(view["market"]) if m["company"] not in blocked), None
            )
            if idx is not None:
                code, _ = http(
                    "POST", "/room/action/take",
                    {"room_id": room_id, "player_name": name, "token": tok, "card_index": idx},
                )
                if code == 200:
                    return True
        # 打出第一张能匹配的手牌(投资)
        for company in COMPANIES:
            code, body = http(
                "POST", "/room/action/play",
                {"room_id": room_id, "player_name": name, "token": tok,
                 "card_company": company, "action": "invest"},
            )
            if code == 200:
                return True
            if "手牌中没有" not in body.get("message", ""):
                print(f"    debug: {name} play {company} -> {code} {body.get('message')}")
        return False

    view = public_view()
    steps = 0
    while view.get("game_status") != "game_over" and steps < 600:
        name = view["current_player"]
        tok = {"小明": tok_a, "小红": tok_b, "小刚": tok_c}[name]
        ok = try_act(name, tok, view)
        if not ok:
            check(False, f"{name} 的回合无法推进(第 {steps} 步)")
            print("    卡住时的视图:", json.dumps(view, ensure_ascii=False, indent=2))
            break
        steps += 1
        view = public_view()

    check(view.get("game_status") == "game_over", f"两轮后游戏结束(共 {steps} 步操作)")
    check(view.get("status") == "finished", "房间状态变为 finished")

    # ---------- 结算检查 ----------
    time.sleep(1.0)
    for name, l in listeners.items():
        overs = l.by_type("game_over")
        rounds = l.by_type("round_end")
        check(len(rounds) == 2, f"{name} 收到 2 次回合结算(实际 {len(rounds)})")
        check(len(overs) == 1, f"{name} 收到 1 次游戏结束事件(实际 {len(overs)})")
        if overs:
            st = overs[0]["data"]["standings"]
            total_score = sum(s["score"] for s in st)
            check(total_score == 4, f"总分守恒: 每轮+2/+1/-1 两轮共4分(实际 {total_score})")
            check(overs[0]["data"]["winner"] == st[0]["player_id"], "胜者是积分最高者")

    for l in listeners.values():
        l.stop()

    # ---------- 断线处理:宽限移出 / 离线禁止开局 / 同名重新加入 ----------
    code, body = http("POST", "/room/create", {"player_name": "稳定房主"})
    rid3, tok_h = body["data"]["room_id"], body["data"]["token"]
    _, body = http("POST", "/room/join", {"room_id": rid3, "player_name": "在线玩家"})
    tok_on = body["data"]["token"]
    _, body = http("POST", "/room/join", {"room_id": rid3, "player_name": "掉线玩家"})
    tok_off = body["data"]["token"]
    http("POST", "/room/ready", {"room_id": rid3, "player_name": "在线玩家", "token": tok_on, "ready": True})
    http("POST", "/room/ready", {"room_id": rid3, "player_name": "掉线玩家", "token": tok_off, "ready": True})

    # 在线的同名玩家不能被顶替
    code, body = http("POST", "/room/join", {"room_id": rid3, "player_name": "在线玩家"})
    check(code == 400, "在线玩家同名加入被拒绝")

    # 有人断线(已 ready)时,房主不能开局
    off_listener = WsListener(rid3, "掉线玩家", tok_off)
    on_listener = WsListener(rid3, "在线玩家", tok_on)
    off_listener.start()
    on_listener.start()
    time.sleep(0.6)
    off_listener.stop()  # 模拟掉线(关闭 WS)
    time.sleep(0.3)
    code, body = http(
        "POST", "/room/start",
        {"room_id": rid3, "player_name": "稳定房主", "token": tok_h, "total_rounds": 2},
    )
    check(code == 400, "有玩家离线时不能开始游戏")

    # 宽限期后,掉线玩家被自动移出房间(房主列表不再显示)
    time.sleep(1.8)
    _, body = http("GET", f"/room/{rid3}")
    names = [p["name"] for p in body["data"]["players"]]
    check("掉线玩家" not in names, f"断线玩家已被自动移出房间(剩余 {names})")
    on_view = {p["name"]: p for p in body["data"]["players"]}
    check(on_view["在线玩家"].get("online") is True, "在线玩家标记为 online")
    check(on_view["稳定房主"].get("online") is not False, "从未连接 WS 的房主不标记离线")

    # 掉线玩家可以重新加入(座位已被宽限移出,属于全新加入,签发新令牌)
    code, body = http("POST", "/room/join", {"room_id": rid3, "player_name": "掉线玩家"})
    check(code == 200, "断线玩家可重新加入房间")
    tok_re = body["data"]["token"]
    code, _ = http("POST", "/room/ready", {"room_id": rid3, "player_name": "掉线玩家", "token": tok_re, "ready": True})
    check(code == 200, "重入后的令牌可用于操作")
    code, body = http(
        "POST", "/room/start",
        {"room_id": rid3, "player_name": "稳定房主", "token": tok_h, "total_rounds": 2},
    )
    check(code == 200, f"重新加入并准备后可以正常开局({body.get('message')})")

    for l in (on_listener,):
        l.stop()

    # ---------- 宽限期内同名重入:座位未释放,复用原令牌 ----------
    code, body = http("POST", "/room/create", {"player_name": "重连房主"})
    rid5, tok_h5 = body["data"]["room_id"], body["data"]["token"]
    _, body = http("POST", "/room/join", {"room_id": rid5, "player_name": "抖动玩家"})
    tok_j = body["data"]["token"]
    jitter_listener = WsListener(rid5, "抖动玩家", tok_j)
    jitter_listener.start()
    time.sleep(0.6)
    jitter_listener.stop()  # 断线进入宽限期,座位仍保留
    time.sleep(0.3)
    code, body = http("POST", "/room/join", {"room_id": rid5, "player_name": "抖动玩家"})
    check(code == 200, "宽限期内同名重入成功")
    check(body["data"]["token"] == tok_j, "宽限期内重入复用原令牌,旧令牌不失效")
    code, _ = http(
        "POST", "/room/ready", {"room_id": rid5, "player_name": "抖动玩家", "token": tok_j, "ready": True},
    )
    check(code == 200, "重入后原令牌可继续操作")
    jitter_listener2 = WsListener(rid5, "抖动玩家", tok_j)
    jitter_listener2.start()
    time.sleep(0.6)
    jitter_listener2.stop()
    http("POST", "/room/delete", {"room_id": rid5, "player_name": "重连房主", "token": tok_h5})

    # ---------- 对局中掉线重连:同名+同房间号恢复座位继续游戏 ----------
    code, body = http("POST", "/room/create", {"player_name": "房主甲"})
    rid6, tok_h6 = body["data"]["room_id"], body["data"]["token"]
    _, body = http("POST", "/room/join", {"room_id": rid6, "player_name": "玩家乙"})
    tok_b6 = body["data"]["token"]
    _, body = http("POST", "/room/join", {"room_id": rid6, "player_name": "玩家丙"})
    tok_c6 = body["data"]["token"]
    http("POST", "/room/ready", {"room_id": rid6, "player_name": "玩家乙", "token": tok_b6, "ready": True})
    http("POST", "/room/ready", {"room_id": rid6, "player_name": "玩家丙", "token": tok_c6, "ready": True})

    lis_h6 = WsListener(rid6, "房主甲", tok_h6)
    lis_b6 = WsListener(rid6, "玩家乙", tok_b6)
    lis_h6.start()
    lis_b6.start()
    time.sleep(0.6)
    code, body = http(
        "POST", "/room/start",
        {"room_id": rid6, "player_name": "房主甲", "token": tok_h6, "total_rounds": 2},
    )
    check(code == 200, "对局重连场景:游戏开始")

    # 玩家丙从未连接过 WS(纯 HTTP 准备),对局中凭昵称+房间号加入补位
    code, body = http("POST", "/room/join", {"room_id": rid6, "player_name": "玩家丙"})
    check(code == 200, "对局进行中,掉线(未连接)的同名玩家可加入继续游戏")
    check(body["data"]["token"] == tok_c6, "对局中重入复用原令牌,旧客户端不失效")
    check(body["data"]["seat"] == 3, "重入座位不变")

    code, body = http("POST", "/room/join", {"room_id": rid6, "player_name": "路人丁"})
    check(code == 400, "对局进行中新玩家不能加入")
    code, body = http("POST", "/room/join", {"room_id": rid6, "player_name": "玩家乙"})
    check(code == 400, "对局进行中在线玩家同名加入被拒绝")

    # 玩家乙掉线:其他人立即收到 offline 标记
    lis_b6.stop()
    time.sleep(0.4)
    _, body = http("GET", f"/room/{rid6}")
    who = {p["name"]: p for p in body["data"]["players"]}
    check(who["玩家乙"].get("online") is False, "对局中掉线立即广播 offline")

    # 掉线的玩家乙凭昵称+房间号重进,座位/令牌不变
    code, body = http("POST", "/room/join", {"room_id": rid6, "player_name": "玩家乙"})
    check(code == 200 and body["data"]["token"] == tok_b6, "对局中掉线玩家可凭昵称+房间号重进")
    lis_b6b = WsListener(rid6, "玩家乙", tok_b6)
    lis_b6b.start()
    time.sleep(0.6)
    states = lis_b6b.by_type("room_state")
    mine = states[-1]["data"]["players"] if states else []
    hand_ok = next((p for p in mine if p["name"] == "玩家乙"), {}).get("hand")
    check(bool(hand_ok), "重进后 WS 恢复,能拿到自己的手牌继续游戏")
    _, body = http("GET", f"/room/{rid6}")
    who = {p["name"]: p for p in body["data"]["players"]}
    check(who["玩家乙"].get("online") is not False, "重连后恢复在线标记")

    # 重进后的玩家乙能继续正常操作:房主甲先走完一手,再轮到玩家乙抽牌
    code, body = http("POST", "/room/action/draw", {"room_id": rid6, "player_name": "房主甲", "token": tok_h6})
    check(code == 200, "房主甲抽牌进入出牌阶段")
    hand_a6 = next(p for p in body["data"]["players"] if p["name"] == "房主甲")["hand"]
    code, _ = http(
        "POST", "/room/action/play",
        {"room_id": rid6, "player_name": "房主甲", "token": tok_h6,
         "card_company": hand_a6[0], "action": "invest"},
    )
    check(code == 200, "房主甲投资一手,轮到玩家乙")
    code, _ = http(
        "POST", "/room/action/draw", {"room_id": rid6, "player_name": "玩家乙", "token": tok_b6},
    )
    check(code == 200, "重进后的玩家乙可正常操作(抽牌)")

    for l in (lis_h6, lis_b6b):
        l.stop()

    # ---------- 房主移出玩家(kick) ----------
    code, body = http("POST", "/room/create", {"player_name": "踢人房主"})
    rid4, tok_h4 = body["data"]["room_id"], body["data"]["token"]
    _, body = http("POST", "/room/join", {"room_id": rid4, "player_name": "捣乱者"})
    tok_bad = body["data"]["token"]
    _, body = http("POST", "/room/join", {"room_id": rid4, "player_name": "旁观者"})
    tok_spec = body["data"]["token"]
    bad_listener = WsListener(rid4, "捣乱者", tok_bad)
    bad_listener.start()
    time.sleep(0.6)

    # 权限与参数校验
    code, _ = http(
        "POST", "/room/kick",
        {"room_id": rid4, "player_name": "旁观者", "token": tok_spec, "target_player_name": "捣乱者"},
    )
    check(code == 403, "非房主不能移出玩家")
    code, _ = http(
        "POST", "/room/kick",
        {"room_id": rid4, "player_name": "踢人房主", "token": tok_h4, "target_player_name": "踢人房主"},
    )
    check(code == 400, "不能移出自己")
    code, _ = http(
        "POST", "/room/kick",
        {"room_id": rid4, "player_name": "踢人房主", "token": tok_h4, "target_player_name": "查无此人"},
    )
    check(code == 404, "移出不存在的玩家报 404")

    # 房主移出捣乱者:其 WS 收到 kicked 事件,令牌随即失效
    code, _ = http(
        "POST", "/room/kick",
        {"room_id": rid4, "player_name": "踢人房主", "token": tok_h4, "target_player_name": "捣乱者"},
    )
    check(code == 200, "房主可以移出玩家")
    time.sleep(0.6)
    check(len(bad_listener.by_type("kicked")) == 1, "被移出者收到 1 次 kicked 事件")
    bad_listener.stop()
    code, _ = http(
        "POST", "/room/ready", {"room_id": rid4, "player_name": "捣乱者", "token": tok_bad, "ready": True},
    )
    check(code == 403, "被移出者的令牌随即失效")
    _, body = http("GET", f"/room/{rid4}")
    names = [p["name"] for p in body["data"]["players"]]
    check("捣乱者" not in names, f"被移出者已不在房间列表(剩余 {names})")

    # ---------- 房主解散房间 ----------
    code, body = http("POST", "/room/create", {"player_name": "独狼"})
    rid2, tok2 = body["data"]["room_id"], body["data"]["token"]
    http("POST", "/room/join", {"room_id": rid2, "player_name": "随从"})
    code, body = http("POST", "/room/leave", {"room_id": rid2, "player_name": "随从", "token": "x"})
    check(code == 403, "错误令牌不能退出房间")
    code, body = http("POST", "/room/leave", {"room_id": rid2, "player_name": "随从", "token": None})
    check(code == 403, "缺少令牌不能退出房间")
    _, body = http("POST", "/room/join", {"room_id": rid2, "player_name": "随从2"})
    tok3 = body["data"]["token"]
    code, _ = http("POST", "/room/leave", {"room_id": rid2, "player_name": "随从2", "token": tok3})
    check(code == 200, "等待期玩家可以退出")
    code, _ = http("POST", "/room/leave", {"room_id": rid2, "player_name": "独狼", "token": tok2})
    check(code == 200, "房主退出解散房间")
    code, _ = http("GET", f"/room/{rid2}")
    check(code == 404, "解散后的房间不存在")

    print()
    if failures:
        print(f"❌ {len(failures)} 项失败:")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print("✅ 全部检查通过")


if __name__ == "__main__":
    import os

    server = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app", "--port", "8765", "--log-level", "warning"],
        cwd=".",
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        env={**os.environ, "STARTUPS_DISCONNECT_GRACE": "1"},  # 缩短断线宽限期便于测试
    )
    try:
        for _ in range(50):
            time.sleep(0.2)
            try:
                urllib.request.urlopen(f"{BASE}/", timeout=1)
                break
            except Exception:
                pass
        main()
    finally:
        server.terminate()
        server.wait(timeout=5)
