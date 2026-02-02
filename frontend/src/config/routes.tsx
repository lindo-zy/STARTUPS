import { lazy } from "react";

// 导入组件
const GameLobby = lazy(() => import("../pages/GameLobby"));
const GamePage = lazy(() => import("../pages/GamePage"));
// const ApiDocs = lazy(() => import("../pages/ApiDocs"));

const routes = [
  {
    path: "/",
    element: <GameLobby />,
  },
  {
    path: "/game",
    element: <GamePage />,
  },
  // {
  //   path: "/api-docs",
  //   element: <ApiDocs />,
  // },
];

export default routes;
