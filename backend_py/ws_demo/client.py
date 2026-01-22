import asyncio
import json

import websockets


# 客户端逻辑：每个客户端独立运行
async def client_task(client_id: int):
    uri = "ws://localhost:8765"
    try:
        async with websockets.connect(uri) as websocket:
            print(f"[Client-{client_id}] 🔌 已连接")

            # 接收欢迎消息（可选）
            welcome = await websocket.recv()
            print(f"[Client-{client_id}] 📩 {json.loads(welcome)}")

            # 延迟 2 秒后发消息
            await asyncio.sleep(2)

            # 构造出牌消息
            message = {
                "action": "play_card",
                "player": f"Client-{client_id}",
                "card": {"suit": "spades", "rank": str(client_id)},
            }

            print(f"[Client-{client_id}] 🕒 2秒后发送消息...")
            await websocket.send(json.dumps(message))
            print(f"[Client-{client_id}] 📤 已发送: {message}")

            # 接收广播（至少接收一次，可能是自己发的消息）
            try:
                response = await asyncio.wait_for(websocket.recv(), timeout=3.0)
                print(f"[Client-{client_id}] 📩 收到广播: {json.loads(response)}")
            except asyncio.TimeoutError:
                print(f"[Client-{client_id}] ⏱️ 超时，未收到更多消息")

    except Exception as e:
        print(f"[Client-{client_id}] ❌ 错误: {e}")


async def main():
    print("🚀 启动 3 个客户端，每个将在连接后 2 秒发送消息...\n")
    # 并发启动 3 个客户端
    tasks = [client_task(i) for i in range(1, 4)]
    await asyncio.gather(*tasks)


if __name__ == "__main__":
    asyncio.run(main())
