import { useObservable } from 'micro-observables';
import { PropsWithChildren, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import AcronymIcon from '@/components/AcronymIcon';
import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import NavBarSelect from '@/components/NavBarSelect';
import { appPaths, authPaths } from '@/routes';
import streamStore from '@/stores/stream';

import css from './NavBar.module.scss';

const USER_MENU = [
  { key: 'settings', icon: 'gear', label: 'Settings' },
  { key: 'sign-out', icon: 'home', label: 'Sign out' },
];

function NavBar() {
  const status = useObservable(streamStore.status);
  const projectList = useObservable(streamStore.projectList);
  const projectMap = useObservable(streamStore.projectMap);
  const projectUuid = useObservable(streamStore.projectUuid);
  const navigate = useNavigate();

  const className = useMemo(() => {
    const classes = [];
    if (!status.connected) classes.push(css.disconnected);
    return classes.join(' ');
  }, [status.connected]);

  const selectedProject = useMemo(() => {
    return projectUuid ? projectMap[projectUuid] : undefined;
  }, [projectMap, projectUuid]);

  const projectMenu = useMemo(
    () =>
      projectList.map((uuid) => {
        const project = projectMap[uuid];
        return {
          key: uuid,
          label: (
            <>
              <AcronymIcon value={project.name} />
              <span>{project.name}</span>
            </>
          ),
        };
      }),
    [projectList, projectMap],
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
        case 'settings':
          navigate(authPaths.settings());
          break;
        case 'sign-out':
          navigate(appPaths.signOut());
          break;
      }
    },
    [navigate],
  );

  return (
    <nav className={className}>
      <section className={css.logo} />
      <section className={css.top}>
        <NavBarItem key="project">
          <NavBarSelect menu={projectMenu} onSelect={(key) => streamStore.setProjectUuid(key)}>
            <AcronymIcon value={selectedProject?.name ?? ''} />
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
