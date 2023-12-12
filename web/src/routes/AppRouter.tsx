import { Navigate, Route, Routes } from 'react-router-dom';

import { appPaths, appRoutes } from '@/routes';
import authStore from '@/stores/auth';

function AppRouter() {
  return (
    <Routes>
      {appRoutes.map((route) => {
        if (route.authRequired && !authStore.token) {
          return <Route {...route} element={<Navigate to={appPaths.signIn()} />} key={route.id} />;
        } else if (route.redirect) {
          /**
           * We treat '*' as a catch-all path and specifically avoid wrapping the
           * `Redirect` with a `DomRoute` component. This ensures the catch-all
           * redirect will occur when encountered in the `Switch` traversal.
           */
          if (route.path === '*') {
            return <Route element={<Navigate to={'/'} />} key={route.id} path={route.path} />;
          } else {
            return (
              <Route element={<Navigate to={route.redirect} />} key={route.id} path={route.path} />
            );
          }
        }
        return <Route {...route} element={route.element} key={route.id} path={route.path} />;
      })}
    </Routes>
  );
}

export default AppRouter;
