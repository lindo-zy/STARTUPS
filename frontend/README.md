# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

```js
const room_id = "123456";
const player_id = "Alice";

// 1. 创建 WebSocket 连接（在 join 房间成功后）
const ws = new WebSocket(`ws://your-domain/ws/${room_id}/${player_id}`);

// 2. 监听消息
ws.onmessage = function(event) {
    // event.data 是字符串！需要解析
    let message;
    try {
        message = JSON.parse(event.data); // 👈 关键：解析 JSON
    } catch (e) {
        console.error("Invalid JSON:", event.data);
        return;
    }

    // 3. 根据 type 分发处理
    switch (message.type) {
        case "room_state":
            console.log("当前房间状态:", message.data);
            updateRoomUI(message.data);
            break;

        case "game_started":
            console.log("游戏开始！完整状态:", message.data);
            startGame(message.data.game_state);
            break;

        case "action":
            console.log("玩家操作:", message.data);
            applyAction(message.data);
            break;

        case "game_over":
            console.log("游戏结束，胜者:", message.data.winner);
            showGameOver(message.data);
            break;

        default:
            console.warn("未知消息类型:", message.type);
    }
};

ws.onerror = (err) => {
    console.error("WebSocket 错误:", err);
};

ws.onclose = () => {
    console.log("连接关闭");
};
```