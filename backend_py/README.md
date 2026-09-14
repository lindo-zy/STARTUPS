# STARTUPS 后端(FastAPI)

STARTUPS 桌游的在线对战服务端,基于 Python FastAPI + WebSocket 实现,内存存储房间状态,适合 3–7 人小局。

## 运行

```bash
cd backend_py
pip install -r requirements.txt
python main.py            # 监听 0.0.0.0:8080
# 或:uvicorn main:app --host 0.0.0.0 --port 8080
```

## 集成测试

模拟 3 名玩家通过 HTTP + WebSocket 走完一整局(含房间流程、规则校验、结算、信息泄露检查):

```bash
python3 test_game_flow.py
```

## 设计要点

- **公司即卡牌**:公司编号为 5~10 的整数,面值 n 的公司共有 n 张卡牌,共 45 张;开局随机移除 5 张。
- **玩家身份**:创建/加入房间时签发 uuid 令牌(token,对应 README 中的“唯一 uuid”),
  后续所有操作与 WebSocket 连接都需携带,服务端校验昵称 + 令牌。
- **房间**:6 位数字邀请码;房主离开即解散房间;非房主在等待期可退出,开始后不可退出。
- **准备机制**:非房主玩家先“准备”,房主在“所有人已准备且 ≥3 人”时才能开始,轮数可选 2~5。
- **断线处理**:等待期玩家 WS 断开后进入宽限期(默认 30 秒,`STARTUPS_DISCONNECT_GRACE` 可调),
  到期仍未重连则自动移出房间并广播;房主断线到期未归则解散房间。已断线(曾连接过)的玩家
  不允许开局,其同名座位可被重新加入顶替(复用原令牌,旧客户端不被顶掉);从未连接过的玩家不受影响。
  **对局进行中**掉线的玩家座位保留并立即向他人广播"离线";其凭"昵称 + 房间号"即可重新加入,
  恢复原座位与手牌/投资继续游戏(复用原令牌);新玩家仍不能在对局中途加入。掉线与重连均实时广播,
  其他玩家的"离线"标记实时更新。
- **回合结构**:每回合两个阶段——`acquire`(抽牌或拿市场牌)→ `play`(投资/上架),
  手牌始终保持 3 张。牌库抽完且当前玩家出牌后立即结算。
  刚从市场拿回的卡牌同回合不能再次上架(投资或打其他手牌不受限);视图以
  `took_from_market_company` 字段下发,前端据此禁用对应手牌的“上架”按钮。
- **反垄断标记**:首个投资者获得;仅当他人持股**严格超过**持有者时转移;持标记者不能从市场
  拿该公司牌、抽牌时无需为该公司市场牌付费、不能将该公司牌上架。
- **结算**:手牌自动转为投资;每家公司唯一最大股东向小股东收 3 元/张(并列则无人收钱),
  付款不足记负资产;按金钱排名 +2/+1/-1 分;打满设定轮数后总分最高者胜(平分按座位顺序)。
- **轮间重置**:每轮完全重置——牌库重新洗牌(移除的卡牌重新随机)、市场清空、投资与
  反垄断标记清零、金钱回初始值,手牌从新牌库重新发放;仅积分跨轮累计。
- **资金兜底**:市场无牌可拿时费用为 0 恒可抽牌;资金不足且市场无牌可拿时免费抽一张,
  保证手牌数不变量,游戏不会死锁。
- **AI 机器人**:房主在等待期可通过 `/room/add_bot` 添加(自动命名 `AI-1`、`AI-2`…,
  自动就座并准备,占用普通座位上限,也可被移出)。开局后轮到机器人时,由服务端按固定
  简单策略代打:获取阶段优先抽牌(付不起就从市场拿一张),出牌阶段直接投资第一张手牌
  (投资不受反垄断/同回合拿回等限制,永远合法),不做任何策略思考。机器人动作之间留有
  间隔(默认 1 秒,`STARTUPS_BOT_DELAY` 可调)并复用真人同款操作日志/事件广播;机器人
  永不掉线,游戏不会因机器人卡住。
- **个性化广播**:WebSocket 按“观察者”裁剪状态——只发自己的手牌,其他人只发数量,
  不泄露牌库与暗牌。页面挂载/刷新后发送 `sync` 上行消息可索取最新状态。

## 接口一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/room/create?player_name=` | 创建房间,返回 `{room_id, token, seat}` |
| POST | `/room/join?room_id=&player_name=` | 加入房间;同名玩家离线时恢复其座位继续游戏(进行中对局同理) |
| POST | `/room/ready?room_id=&player_name=&token=&ready=` | 准备/取消准备 |
| POST | `/room/leave?room_id=&player_name=&token=` | 退出(房主退出=解散) |
| POST | `/room/kick?room_id=&player_name=&token=&target_player_name=` | 房主移出玩家(仅等待期) |
| POST | `/room/add_bot?room_id=&player_name=&token=` | 房主添加 AI 机器人(仅等待期,自动命名 AI-N 并准备) |
| DELETE | `/room/delete?room_id=&player_name=&token=` | 解散房间(仅房主) |
| GET | `/room/list` | 房间列表(不含已结束) |
| GET | `/room/{room_id}` | 房间公共信息(不含任何手牌) |
| POST | `/room/start?room_id=&player_name=&token=&total_rounds=2` | 开始游戏(仅房主) |
| POST | `/room/action/draw?room_id=&player_name=&token=` | 从牌库抽牌 |
| POST | `/room/action/take?...&card_index=` | 从市场拿牌 |
| POST | `/room/action/play?...&card_company=&action=invest\|to_market` | 出牌 |

统一响应信封:`{"code": 200, "message": "success", "data": ...}`;错误同样走该信封并携带 HTTP 状态码。

## WebSocket

连接:`ws://{host}:8080/{room_id}/{player_name}?token={token}`(玩家名需 URL 编码)。

服务端下发消息:

| type | 说明 |
| --- | --- |
| `room_state` | 个性化房间视图(自己的手牌 + 公共状态),随每次状态变化推送 |
| `game_started` | 开局提示 |
| `action` | 操作日志(如“玩家A 投资了公司 7”),前端做 toast 展示 |
| `round_end` | 回合结算:排名、金额变动、分数变动 |
| `game_over` | 终局:胜者与最终排名 |
| `room_deleted` | 房间被解散 |
| `kicked` | 被房主移出房间(仅被移出者收到,随后连接被关闭) |

客户端可随时发送任意上行文本(如 `sync`)索取最新状态快照。
