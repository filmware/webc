import { useObservable } from 'micro-observables';
import { PropsWithChildren, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { Logo } from '@/assets';
import AcronymIcon from '@/components/AcronymIcon';
import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import NavBarSelect from '@/components/NavBarSelect';
import { appPaths } from '@/routes';
import streamStore from '@/stores/stream';

import css from './NavBar.module.scss';

const USER_MENU = [
  { key: 'settings', icon: 'gear', label: 'Settings' },
  { key: 'sign-out', icon: 'home', label: 'Sign out' },
];

function NavBar() {
  const projectList = useObservable(streamStore.projectList);
  const projectUuid = useObservable(streamStore.projectUuid);
  const navigate = useNavigate();

  const project = useMemo(
    () => projectList.find((p) => p.project === projectUuid),
    [projectList, projectUuid],
  );

  const projectMenu = useMemo(
    () =>
      projectList.map((p) => ({
        key: p.project,
        label: (
          <>
            <AcronymIcon value={p.name} />
            <span>{p.name}</span>
          </>
        ),
      })),
    [projectList],
  );

  const userMenu = useMemo(
    () =>
      USER_MENU.map((item) => ({
        key: item.key,
        label: (
          <>
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </>
        ),
      })),
    [],
  );

  const handleUserMenuSelect = useCallback(
    (key: string) => {
      switch (key) {
        case 'sign-out':
          navigate(appPaths.signOut());
          break;
      }
    },
    [navigate],
  );

  return (
    <nav>
      <section className={css.logo}>
        <NavBarItem key="logo">
          <Logo />
        </NavBarItem>
      </section>
      <section className={css.top}>
        <NavBarItem key="project">
          <NavBarSelect menu={projectMenu} onSelect={(key) => streamStore.setProjectUuid(key)}>
            <AcronymIcon value={project?.name ?? ''} />
          </NavBarSelect>
        </NavBarItem>
        <NavBarItem icon="home" key="home" to="/app" />
        <NavBarItem icon="chat" key="chat" to="/chat" />
      </section>
      <section className={css.bottom}>
        <NavBarItem icon="bell" key="alerts" />
        <NavBarItem key="project">
          <NavBarSelect menu={userMenu} placement="top" onSelect={handleUserMenuSelect}>
            <Avatar name="Caleb Kang" />
          </NavBarSelect>
        </NavBarItem>
      </section>
    </nav>
  );
}

type NavBarItemProps = {
  key: string;
  icon?: string;
  onClick?: (e: React.MouseEvent) => void;
  to?: string;
};

function NavBarItem({ children, icon, onClick, to }: PropsWithChildren<NavBarItemProps>) {
  const location = useLocation();
  const navigate = useNavigate();

  const isActive = useMemo(() => {
    return to && location.pathname.indexOf(to) === 0;
  }, [location.pathname, to]);

  const className = useMemo(() => {
    const classes = [css.navBarItem];
    if (isActive) classes.push(css.active);
    return classes.join(' ');
  }, [isActive]);

  const iconName = useMemo(() => {
    return `${icon}${isActive ? 'On' : ''}`;
  }, [icon, isActive]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (to) navigate(to);
      onClick?.(e);
    },
    [navigate, onClick, to],
  );

  return (
    <div className={className} onClick={handleClick}>
      {icon && <Icon name={iconName} />}
      {children}
    </div>
  );
}

export default NavBar;
