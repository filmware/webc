import { Select } from 'antd';
import { useObservable } from 'micro-observables';
import { useMemo } from 'react';
import { NavLink } from 'react-router-dom';

import HomeRouter from '@/routes/HomeRouter';
import themeStore from '@/stores/theme';

import css from './Home.module.scss';

function Home() {
  const isDarkMode = useObservable(themeStore.isDarkMode);

  const className = useMemo(() => {
    const classes = [css.base];
    if (isDarkMode) classes.push(css.dark);
    return classes.join(' ');
  }, [isDarkMode]);

  return (
    <div className={className}>
      <SideBar />
      <div className={css.main}>
        <HomeRouter />
      </div>
    </div>
  );
}

function SideBar() {
  return (
    <div className={css.sidebar}>
      <section className={css.date}>
        <Select placeholder="Select the date" />
      </section>
      <section>
        <NavLink to="overview">Overview</NavLink>
        <NavLink to="clips">Clips</NavLink>
        <a>Upload Report</a>
      </section>
    </div>
  );
}

export default Home;
