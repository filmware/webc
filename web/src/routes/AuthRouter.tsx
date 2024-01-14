import { Navigate, Route, Routes } from 'react-router-dom';

import { authPaths, authRoutes } from '@/routes';

function AuthRouter() {
  return (
    <Routes>
      {authRoutes.map((route) => {
        return route.path === '*' ? (
          <Route element={<Navigate to={authPaths.home()} />} key={route.id} path={route.path} />
        ) : (
          <Route {...route} element={route.element} key={route.id} path={route.path} />
        );
      })}
    </Routes>
  );
}

export default AuthRouter;
