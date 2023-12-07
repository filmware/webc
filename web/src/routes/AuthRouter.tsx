import { Navigate, Route, Routes } from 'react-router-dom'

import { authRoutes } from '@/routes'

function AuthRouter() {
  return (
    <Routes>
      {authRoutes.map((route) => {
        return route.path === '*'
          ? <Route element={<Navigate to={'/app'} />} key={route.id} path={route.path} />
          : <Route {...route} element={route.element} key={route.id} path={route.path} />
      })}
    </Routes>
  )
}

export default AuthRouter
