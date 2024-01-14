import { RouteProps } from 'react-router-dom';

import Authenticated from '@/pages/Authenticated/Authenticated';
import Chat from '@/pages/Authenticated/Chat';
import Clips from '@/pages/Authenticated/Clips';
import Home from '@/pages/Authenticated/Home/Home';
import SignIn from '@/pages/SignIn/SignIn';
import SignOut from '@/pages/SignOut/SignOut';

type RouteConfig = {
  authRequired?: boolean;
  id: string;
  path: string;
  popout?: boolean;
  redirect?: string;
  title?: string;
} & RouteProps;

export const appPaths = {
  app: () => '/app',
  authenticated: () => '/*',
  signIn: () => '/sign-in',
  signOut: () => '/sign-out',
};

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
];

export const authPaths = {
  chat: () => 'chat',
  clips: () => 'clips',
  home: () => 'app',
};

export const authRoutes: RouteConfig[] = [
  {
    element: <Home />,
    id: 'home',
    path: authPaths.home(),
  },
  {
    element: <Chat />,
    id: 'chat',
    path: authPaths.chat(),
  },
  {
    element: <Clips />,
    id: 'clips',
    path: authPaths.clips(),
  },
];
