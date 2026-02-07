import React, { Suspense } from "react";
import { BrowserRouter as Router, useRoutes } from "react-router-dom";

import routes from "./config/routes";

const RouteApp: React.FC = () => {
  const element = useRoutes(routes);
  return element;
};

function App() {
  return (
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
  );
}

export default App;
