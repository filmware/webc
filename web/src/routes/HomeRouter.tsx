import { Navigate, Route, Routes } from 'react-router-dom';

import { homeRoutes } from '@/routes';

function HomeRouter() {
  return (
    <Routes>
      {homeRoutes.map((route) => {
        return route.path === '*' ? (
          <Route element={<Navigate to={'overview'} />} key={route.id} path={route.path} />
        ) : (
          <Route {...route} element={route.element} key={route.id} path={route.path} />
        );
      })}
    </Routes>
  );
}

export default HomeRouter;
