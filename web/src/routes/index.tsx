import { RouteProps } from 'react-router-dom';

import Authenticated from '@/pages/Authenticated/Authenticated';
import Chat from '@/pages/Authenticated/Chat';
import Clips from '@/pages/Authenticated/Home/Clips';
import Home from '@/pages/Authenticated/Home/Home';
import Overview from '@/pages/Authenticated/Home/Overview';
import Settings from '@/pages/Authenticated/Settings/Settings';
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
  authenticated: () => '*',
  signIn: () => 'sign-in',
  signOut: () => 'sign-out',
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
  home: () => 'app/*',
  settings: () => 'settings',
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
    element: <Settings />,
    id: 'settings',
    path: authPaths.settings(),
  },
  // {
  //   id: 'catch-all',
  //   path: '*',
  //   redirect: authPaths.home(),
  // },
];

export const homePaths = {
  overview: () => 'overview',
  clips: () => 'clips',
};

export const homeRoutes: RouteConfig[] = [
  {
    element: <Overview />,
    id: 'overview',
    path: homePaths.overview(),
  },
  {
    element: <Clips />,
    id: 'clips',
    path: homePaths.clips(),
  },
  // {
  //   id: 'catch-all',
  //   path: '*',
  //   redirect: homePaths.overview(),
  // },
];
