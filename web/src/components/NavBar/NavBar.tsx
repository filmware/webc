import { PropsWithChildren, useCallback, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { Logo } from '@/assets';
import AcronymIcon from '@/components/AcronymIcon';
import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import NavBarSelect from '@/components/NavBarSelect';

import css from './NavBar.module.scss';

type Project = {
  id: string;
  name: string;
};

const PROJECTS: Project[] = [
  { id: 'barbie', name: 'Barbie 4' },
  { id: 'santa', name: 'Santa in the Outfield' },
  { id: 'diehard', name: 'Die Hard 7: Die Hardest' },
  { id: 'zombie', name: 'Zombie Sleepover' },
];

const USER_MENU = [
  { key: 'settings', icon: 'gear', label: 'Settings' },
  { key: 'sign-out', icon: 'home', label: 'Sign out' },
];

function NavBar() {
  const [projectId, setProjectId] = useState(PROJECTS[0].id);

  const project = useMemo(() => PROJECTS.find((project) => project.id === projectId), [projectId]);

  const projectMenu = useMemo(
    () =>
      PROJECTS.map((project) => ({
        key: project.id,
        label: (
          <>
            <AcronymIcon value={project.name} />
            <span>{project.name}</span>
          </>
        ),
      })),
    [],
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

  return (
    <nav>
      <section className={css.logo}>
        <NavBarItem key="logo">
          <Logo />
        </NavBarItem>
      </section>
      <section className={css.top}>
        <NavBarItem key="project">
          <NavBarSelect menu={projectMenu} onSelect={(key) => setProjectId(key)}>
            <AcronymIcon value={project?.name ?? ''} />
          </NavBarSelect>
        </NavBarItem>
        <NavBarItem icon="home" key="home" to="/app" />
        <NavBarItem icon="chat" key="chat" to="/chat" />
        <NavBarItem icon="bell" key="alerts" />
      </section>
      <section className={css.bottom}>
        <NavBarItem key="project">
          <NavBarSelect menu={userMenu} placement="top">
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
      {icon && <Icon name={iconName} size="large" />}
      {children}
    </div>
  );
}

export default NavBar;
