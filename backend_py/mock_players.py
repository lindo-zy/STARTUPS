"""STARTUPS mock 玩家测试器。

在本机对运行中的后端启动 N 个模拟玩家客户端(纯黑盒:只使用与前端完全相同的
HTTP + WebSocket 通道),自动完成多局完整对局,并逐条校验游戏规则不变量:

- 信息安全:任何 room_state 不得泄露他人手牌/牌库/暗牌
- 手牌不变量:acquire 阶段所有玩家手牌 = 3;play 阶段当前玩家 = 3或4、其他 = 3
- 金钱守恒:玩家金钱总和 + 市场卡上金币 + 回合切换时被清场的金币 == 初始总金钱
- 卡牌守恒:本轮新增投资 + 手牌 + 市场 + 牌库 + 暗牌 == 45(全部卡牌)
- 回合与事件:round_end 事件数 = 总轮数且分差守恒(+2/+1/-1);game_over 恰好 1 次
- 非法操作:错误令牌 403、未轮到 400、持反垄断标记拿市场牌 400、
  刚从市场拿回的卡牌同回合再上架 400

运行(需后端已在 8080 端口运行):
    cd backend_py && python3 mock_players.py
"""

import asyncio
import json
import os
import random
import sys
import time
from urllib.parse import quote

import httpx
import websockets

BASE_HTTP = os.environ.get("STARTUPS_HTTP", "http://127.0.0.1:8080")
BASE_WS = "ws://127.0.0.1:8080"
COMPANIES = [5, 6, 7, 8, 9, 10]
START_MONEY = 10
TOTAL_CARDS = 45             # 40 张流通 + 5 张暗牌
RANK_POINTS_NET = 2          # 每轮 +2 +1 -1 的净值

# 对局计划:(局号, 人数, 总轮数)
GAMES_PLAN = [(1, 3, 2), (2, 3, 3), (3, 4, 2), (4, 5, 2), (5, 7, 2)]


class Checker:
    def __init__(self):
        self.passed = 0
        self.failures = []

    def check(self, cond, label, ctx=""):
        if cond:
            self.passed += 1
        else:
            self.failures.append(f"{ctx} {label}".strip())
            print(f"    [FAIL] {ctx} {label}".rstrip())
        return cond


def me_of(view, name):
    return next(p for p in view["players"] if p["name"] == name)


def blocked_set(me):
    return {int(k) for k, v in (me.get("antimonopoly") or {}).items() if v}


def state_tuple(v):
    """视图的关键字段摘要,用于比较状态是否一致/发生变化。"""
    return (
        v.get("round_number"),
        v.get("deck_count"),
        len(v.get("market", [])),
        v.get("current_player"),
        v.get("turn_phase"),
        v.get("game_status"),
        tuple(sorted((p["name"], p.get("hand_count", 0)) for p in v["players"])),
    )


class MockPlayer:
    """一个模拟玩家:WS 监听(校验每条推送)+ HTTP 操作。"""

    def __init__(self, name, room_id, token, checker, ctx):
        self.name = name
        self.room_id = room_id
        self.token = token
        self.checker = checker
        self.ctx = ctx
        self.http = httpx.AsyncClient(base_url=BASE_HTTP, timeout=10)
        self.last_view = None
        self.round_end_events = []
        self.game_over_events = []
        self.destroyed_coins = 0          # 回合切换时市场卡上被清掉的金币
        self.round_start_inv_sum = None   # 本轮开始时的投资总数(用于卡牌守恒)
        self._stop = False

    # ---------- WebSocket ----------
    async def listen(self):
        url = f"{BASE_WS}/{self.room_id}/{quote(self.name)}?token={self.token}"
        async with websockets.connect(url) as ws:
            while not self._stop:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=0.25)
                except asyncio.TimeoutError:
                    continue
                except websockets.ConnectionClosed:
                    break
                msg = json.loads(raw)
                mtype = msg.get("type")
                if mtype == "room_state":
                    self._on_state(msg["data"])
                elif mtype == "round_end":
                    self.round_end_events.append(msg["data"])
                    self._check_round_end(msg["data"])
                elif mtype == "game_over":
                    self.game_over_events.append(msg["data"])

    def _on_state(self, view):
        prev = self.last_view
        self.last_view = view
        c, ctx = self.checker, self.ctx

        # 泄露检查
        if "market_deck" in view or "removed_cards" in view:
            c.check(False, "room_state 泄露牌库/暗牌", ctx)
        for p in view.get("players", []):
            if "hand" in p and p["name"] != self.name:
                c.check(False, f"room_state 泄露 {p['name']} 的手牌", ctx)
        me = me_of(view, self.name)
        if "hand" in me and len(me["hand"]) != me.get("hand_count", len(me["hand"])):
            c.check(False, "自己的 hand 与 hand_count 不一致", ctx)

        # 回合切换:统计被清场金币,重置轮初投资快照
        if prev and view.get("round_number", 0) > prev.get("round_number", 0):
            self.destroyed_coins += sum(m["coins_on_top"] for m in prev.get("market", []))
            self.round_start_inv_sum = None

        if view.get("game_status") != "active":
            return

        phase = view.get("turn_phase")
        hands = {p["name"]: p.get("hand_count", 0) for p in view["players"]}
        if phase == "acquire":
            bad = {n: h for n, h in hands.items() if h != 3}
            c.check(not bad, f"acquire 阶段手牌应为 3,实际 {bad}", ctx)
            if self.round_start_inv_sum is None:
                self.round_start_inv_sum = sum(
                    sum(p.get("investments", {}).values()) for p in view["players"]
                )
        elif phase == "play":
            cur = view.get("current_player")
            bad_others = {n: h for n, h in hands.items() if n != cur and h != 3}
            c.check(not bad_others, f"play 阶段非当前玩家手牌应为 3,实际 {bad_others}", ctx)
            c.check(hands.get(cur) in (3, 4), f"play 阶段当前玩家手牌异常: {hands.get(cur)}", ctx)

        # 卡牌守恒:本轮新增投资 + 手牌 + 市场 + 牌库 + 暗牌 == 45
        if self.round_start_inv_sum is not None:
            inv_sum = sum(sum(p.get("investments", {}).values()) for p in view["players"])
            total = (
                (inv_sum - self.round_start_inv_sum)
                + sum(hands.values())
                + len(view.get("market", []))
                + view.get("deck_count", 0)
                + view.get("removed_count", 0)
            )
            c.check(
                total == TOTAL_CARDS,
                f"卡牌守恒失败: {total} != {TOTAL_CARDS}",
                ctx,
            )

        # 金钱守恒
        money_sum = sum(p.get("money", 0) for p in view["players"])
        coins = sum(m["coins_on_top"] for m in view.get("market", []))
        n_players = len(view["players"])
        c.check(
            money_sum + coins + self.destroyed_coins == START_MONEY * n_players,
            f"金钱守恒失败: {money_sum}+{coins}+{self.destroyed_coins} != {START_MONEY * n_players}",
            ctx,
        )

    def _check_round_end(self, data):
        deltas = [s.get("score_delta", 0) for s in data.get("standings", [])]
        self.checker.check(
            sum(deltas) == RANK_POINTS_NET,
            f"round_end 分差守恒失败: {deltas}",
            self.ctx,
        )

    async def wait_until(self, pred, timeout=4.0):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.last_view and pred(self.last_view):
                return True
            await asyncio.sleep(0.05)
        return False

    # ---------- HTTP ----------
    async def act(self, path, params=None, expect_code=200):
        r = await self.http.post(path, params=params)
        body = r.json()
        if body.get("code") != expect_code:
            self.checker.check(
                False,
                f"{path} 期望 {expect_code} 实际 {body.get('code')}: {body.get('message')}",
                self.ctx,
            )
            return None
        self.checker.passed += 1
        return body.get("data")

    async def close(self):
        self._stop = True
        try:
            await self.http.aclose()
        except Exception:
            pass


async def run_game(game_no, n_players, total_rounds, checker, rng):
    ctx = f"[局{game_no}/{n_players}人]"
    print(f"{ctx} 开始({total_rounds} 轮)...", flush=True)
    async with httpx.AsyncClient(base_url=BASE_HTTP, timeout=10) as setup:
        r = (await setup.post("/room/create", params={"player_name": f"bot{game_no}-1"})).json()
        assert r["code"] == 200, r
        room_id, tokens = r["data"]["room_id"], {f"bot{game_no}-1": r["data"]["token"]}
        for i in range(2, n_players + 1):
            r = (
                await setup.post(
                    "/room/join",
                    params={"room_id": room_id, "player_name": f"bot{game_no}-{i}"},
                )
            ).json()
            assert r["code"] == 200, r
            tokens[f"bot{game_no}-{i}"] = r["data"]["token"]
        player_names = [f"bot{game_no}-{i}" for i in range(1, n_players + 1)]
        for name in player_names[1:]:
            r = (
                await setup.post(
                    "/room/ready",
                    params={"room_id": room_id, "player_name": name, "token": tokens[name], "ready": True},
                )
            ).json()
            assert r["code"] == 200, r
        r = (
            await setup.post(
                "/room/start",
                params={
                    "room_id": room_id,
                    "player_name": player_names[0],
                    "token": tokens[player_names[0]],
                    "total_rounds": total_rounds,
                },
            )
        ).json()
        assert r["code"] == 200, r

    bots = {name: MockPlayer(name, room_id, tokens[name], checker, ctx) for name in player_names}
    listeners = [asyncio.create_task(b.listen()) for b in bots.values()]
    # 等待所有 bot 收到初始状态
    ok = await asyncio.gather(
        *(b.wait_until(lambda v: v.get("game_status") == "active" and v.get("round_number") == 1) for b in bots.values())
    )
    checker.check(all(ok), "有 bot 未收到初始游戏状态", ctx)
    await asyncio.sleep(0.2)

    host = bots[player_names[0]]

    # ---- 非法操作负样本 ----
    wrong = bots[player_names[1]]
    r = await wrong.http.post(
        "/room/action/draw",
        params={"room_id": room_id, "player_name": wrong.name, "token": "bad-token"},
    )
    checker.check(r.json()["code"] == 403, "错误令牌未被拒绝(403)", ctx)
    r = await wrong.http.post(
        "/room/action/draw", params={"room_id": room_id, "player_name": wrong.name, "token": wrong.token}
    )
    checker.check(r.json()["code"] == 400, "未轮到玩家未被拒绝(400)", ctx)

    # ---- 自动对局 ----
    deadline = time.monotonic() + 300
    steps = 0
    aborted = False
    while time.monotonic() < deadline:
        view = (await host.http.get(f"/room/{room_id}")).json()["data"]
        if view.get("game_status") == "game_over":
            break
        name = view["current_player"]
        bot = bots[name]
        pre_tuple = state_tuple(view)

        # 当前玩家的个性化视图需已同步到位(公共视图没有手牌)
        synced = await bot.wait_until(lambda v: state_tuple(v) == pre_tuple)
        if not synced:
            checker.check(False, "当前玩家视图未同步到公共状态", ctx)
            break
        me = me_of(bot.last_view, name)
        blocked = blocked_set(me)
        acted = False

        if view["turn_phase"] == "acquire":
            cost = sum(1 for m in view["market"] if m["company"] not in blocked)
            affordable = cost == 0 or me["money"] >= cost
            takeables = [i for i, m in enumerate(view["market"]) if m["company"] not in blocked]

            # 负样本:持反垄断标记时尝试拿该公司市场牌,应被 400 拒绝
            blocked_idx = next((i for i, m in enumerate(view["market"]) if m["company"] in blocked), None)
            if blocked_idx is not None and rng.random() < 0.3:
                r = await bot.http.post(
                    "/room/action/take",
                    params={"room_id": room_id, "player_name": name, "token": bot.token, "card_index": blocked_idx},
                )
                checker.check(r.json()["code"] == 400, "持反垄断标记拿市场牌未被拒绝(400)", ctx)

            if view["deck_count"] > 0 and affordable and rng.random() < 0.6:
                data = await bot.act("/room/action/draw", {"room_id": room_id, "player_name": name, "token": bot.token})
                acted = data is not None
            elif takeables:
                idx = rng.choice(takeables)
                data = await bot.act(
                    "/room/action/take",
                    {"room_id": room_id, "player_name": name, "token": bot.token, "card_index": idx},
                )
                acted = data is not None
            elif view["deck_count"] > 0:
                # 免费兜底抽牌
                data = await bot.act("/room/action/draw", {"room_id": room_id, "player_name": name, "token": bot.token})
                acted = data is not None

        if not acted:
            hand = me.get("hand") or []
            if not hand:
                checker.check(False, "轮到该玩家但其个性化视图没有手牌", ctx)
                aborted = True
                break
            # 负样本:本回合刚从市场拿回的公司,尝试再上架应被 400 拒绝
            just_taken = (bot.last_view or {}).get("took_from_market_company")
            if just_taken is not None and just_taken in hand and rng.random() < 0.5:
                r = await bot.http.post(
                    "/room/action/play",
                    params={
                        "room_id": room_id,
                        "player_name": name,
                        "token": bot.token,
                        "card_company": just_taken,
                        "action": "to_market",
                    },
                )
                checker.check(
                    r.json()["code"] == 400, "刚从市场拿回的卡牌再上架未被拒绝(400)", ctx
                )
            card = rng.choice(hand)
            action = (
                "to_market"
                if (card not in blocked and card != just_taken and rng.random() < 0.35)
                else "invest"
            )
            data = await bot.act(
                "/room/action/play",
                {
                    "room_id": room_id,
                    "player_name": name,
                    "token": bot.token,
                    "card_company": card,
                    "action": action,
                },
            )
            if data is None:
                aborted = True
                break

        steps += 1
        # 等待所有 bot 观察到状态变化(校验广播链路)
        ok = await asyncio.gather(
            *(b.wait_until(lambda v, pre=pre_tuple: state_tuple(v) != pre) for b in bots.values())
        )
        if not all(ok):
            checker.check(False, "有 bot 未在超时内收到操作后的广播", ctx)
    else:
        if not aborted:
            checker.check(False, f"对局超时未结束(已执行 {steps} 步)", ctx)

    await asyncio.sleep(0.5)

    # ---- 终局校验 ----
    final = (await host.http.get(f"/room/{room_id}")).json()["data"]
    if final.get("game_status") == "game_over":
        scores = {p["name"]: p.get("score", 0) for p in final["players"]}
        checker.check(sum(scores.values()) == RANK_POINTS_NET * total_rounds, f"总分守恒失败: {scores}", ctx)
        top = max(scores.values())
        winners = [n for n, s in scores.items() if s == top]
        for b in bots.values():
            checker.check(len(b.game_over_events) == 1, f"{b.name} game_over 事件数={len(b.game_over_events)}", ctx)
            checker.check(
                len(b.round_end_events) == total_rounds,
                f"{b.name} round_end 事件数={len(b.round_end_events)} != {total_rounds}",
                ctx,
            )
            if b.game_over_events:
                winner = b.game_over_events[0]["winner"]
                checker.check(winner in winners, f"胜者 {winner} 不在最高分名单 {winners}", ctx)
        print(f"{ctx} 正常结束,共 {steps} 步,最终得分 {scores}", flush=True)
    else:
        checker.check(False, "对局未正常结束", ctx)

    for b in bots.values():
        await b.close()
    for t in listeners:
        t.cancel()
    await asyncio.gather(*listeners, return_exceptions=True)


async def main():
    checker = Checker()
    for game_no, n, rounds in GAMES_PLAN:
        rng = random.Random(1000 + game_no)
        try:
            await run_game(game_no, n, rounds, checker, rng)
        except Exception as e:  # noqa: BLE001
            checker.failures.append(f"[局{game_no}] 异常: {type(e).__name__}: {e}")
            print(f"  [FAIL] [局{game_no}] 异常: {type(e).__name__}: {e}")
        await asyncio.sleep(0.3)

    print()
    print(f"校验通过 {checker.passed} 项,失败 {len(checker.failures)} 项")
    if checker.failures:
        print("失败明细:")
        for f in checker.failures:
            print("  -", f)
        sys.exit(1)
    print("✅ 全部 mock 对局通过,未发现 bug")


if __name__ == "__main__":
    asyncio.run(main())
