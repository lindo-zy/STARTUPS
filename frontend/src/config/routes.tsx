import React from "react";

const GameLobby = React.lazy(() => import("../pages/GameLobby"));
const GamePage = React.lazy(() => import("../pages/GamePage"));

const routes = [
  {
    path: "/",
    element: <GameLobby />,
  },
  {
    path: "/game",
    element: <GamePage />,
  },
];

export default routes;
