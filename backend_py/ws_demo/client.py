# interactive_client.py
import asyncio

import websockets


async def interactive_client(client_id: str):
    uri = f"ws://localhost:8080/ws/{client_id}/你好"
    try:
        async with websockets.connect(uri) as websocket:
            print(
                f"[Client {client_id}] Connected to WebSocket server. Type your message (or 'quit' to exit):"
            )

            # 启动一个任务专门接收消息
            async def receive_messages():
                try:
                    while True:
                        msg = await websocket.recv()
                        print(f"\n[Received] {msg}")
                        print(">>> ", end="", flush=True)  # 提示用户继续输入
                except websockets.exceptions.ConnectionClosed:
                    print("\n[Info] Server closed the connection.")
                    return

            recv_task = asyncio.create_task(receive_messages())

            # 主循环：读取用户输入并发送
            loop = asyncio.get_event_loop()
            while True:
                # 使用 run_in_executor 避免 input() 阻塞事件循环
                try:
                    user_input = await loop.run_in_executor(None, input, ">>> ")
                except EOFError:
                    break

                if user_input.strip().lower() == "quit":
                    print("[Client] Disconnecting...")
                    break

                if user_input.strip():
                    await websocket.send(user_input)

            recv_task.cancel()
            try:
                await recv_task
            except asyncio.CancelledError:
                pass

    except Exception as e:
        print(f"[Error] {e}")


if __name__ == "__main__":

    asyncio.run(interactive_client("123456"))
