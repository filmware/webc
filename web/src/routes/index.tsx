import { RouteProps } from 'react-router-dom'

import Authenticated from '@/pages/Authenticated'
import Dashboard from '@/pages/Authenticated/Dashboard'
import SignIn from '@/pages/SignIn'
import SignOut from '@/pages/SignOut'

type RouteConfig = {
  authRequired?: boolean
  id: string
  path: string
  popout?: boolean
  redirect?: string
  title?: string
} & RouteProps

export const appPaths = {
  authenticated: () => '/*',
  signIn: () => '/sign-in',
  signOut: () => '/sign-out',
}

export const appRoutes: RouteConfig[] = [
  {
    authRequired: true,
    element: <Authenticated />,
    id: 'authenticated',
    path: appPaths.authenticated(),
  },
  {
    element: <SignIn />,
    id: 'sign-in',
    path: appPaths.signIn(),
  },
  {
    element: <SignOut />,
    id: 'sign-in',
    path: appPaths.signOut(),
  },
]

export const authPaths = {
  dashboard: () => '/app',
}

export const authRoutes: RouteConfig[] = [
  {
    element: <Dashboard />,
    id: 'dashboard',
    path: authPaths.dashboard(),
  },
  {
    id: 'catch-all',
    path: '*',
    redirect: authPaths.dashboard(),
  },
]
