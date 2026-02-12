import React, { Suspense } from "react";
import { BrowserRouter as Router, useRoutes } from "react-router-dom";

import routes from "./config/routes";
import {SocketProvider} from "./context/SocketContext.tsx";

const RouteApp: React.FC = () => {
  const element = useRoutes(routes);
  return element;
};

function App() {
  return (
  <SocketProvider>
    <Router>
      <Suspense
        fallback={
          <div className="flex items-center justify-center min-h-screen">
            Loading...
          </div>
        }
      >
        <RouteApp />
      </Suspense>
    </Router>
  </SocketProvider>
  );
}

export default App;
