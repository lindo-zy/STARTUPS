import asyncio
import json

import websockets

# 存储所有连接的客户端
connected_clients = set()


async def handle_client(websocket, path):
    # 新客户端加入
    connected_clients.add(websocket)
    client_id = id(websocket)
    print(f"✅ 客户端 {client_id} 已连接。当前在线人数: {len(connected_clients)}")

    try:
        # 发送欢迎消息
        await websocket.send(
            json.dumps({"type": "system", "message": "欢迎加入游戏！你已连接成功。"})
        )

        # 广播“新玩家加入”
        join_msg = {"type": "system", "message": f"玩家 {client_id} 加入了游戏。"}
        await broadcast(json.dumps(join_msg), sender=websocket)

        # 监听客户端消息
        async for message in websocket:
            print(f"📥 收到来自 {client_id} 的消息: {message}")

            try:
                data = json.loads(message)
                # 可选：验证消息格式
                if "action" not in data:
                    raise ValueError("缺少 action 字段")
            except (json.JSONDecodeError, ValueError) as e:
                await websocket.send(
                    json.dumps({"type": "error", "message": f"无效消息格式: {str(e)}"})
                )
                continue

            # 广播给其他所有人（包括自己，根据需求可排除）
            await broadcast(message, sender=None)  # 这里广播给所有人，包括发送者

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        # 客户端断开
        connected_clients.remove(websocket)
        leave_msg = {"type": "system", "message": f"玩家 {client_id} 离开了游戏。"}
        await broadcast(json.dumps(leave_msg), sender=None)
        print(f"❌ 客户端 {client_id} 断开连接。当前在线人数: {len(connected_clients)}")


async def broadcast(message: str, sender=None):
    """广播消息给所有连接的客户端（可选排除 sender）"""
    if connected_clients:
        # 如果你想排除发送者（比如聊天不回显），用：
        # recipients = [client for client in connected_clients if client != sender]
        # 这里我们广播给所有人（包括发送者），适合游戏状态同步
        recipients = connected_clients.copy()
        await asyncio.gather(
            *[client.send(message) for client in recipients], return_exceptions=True
        )


if __name__ == "__main__":
    print("🚀 WebSocket 广播服务器启动中... ws://localhost:8765")
    start_server = websockets.serve(handle_client, "localhost", 8765)
    asyncio.get_event_loop().run_until_complete(start_server)
    asyncio.get_event_loop().run_forever()
