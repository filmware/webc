import { Input } from 'antd';
import { useObservable } from 'micro-observables';
import { useMemo } from 'react';

import Icon from '@/components/Icon';
import streamStore from '@/stores/stream';
import themeStore from '@/stores/theme';

import css from './SideBar.module.scss';

function SideBar() {
  const isDarkMode = useObservable(themeStore.isDarkMode);
  const topicUuid = useObservable(streamStore.topicUuid);
  const topicList = useObservable(streamStore.topicList);
  const topicMap = useObservable(streamStore.topicMap);

  const className = useMemo(() => {
    const classes = [css.base];
    if (isDarkMode) classes.push(css.dark);
    return classes.join(' ');
  }, [isDarkMode]);

  return (
    <div className={className}>
      <section className={css.search}>
        <Input allowClear placeholder="Search topics" />
      </section>
      <section>
        <h4>Topics</h4>
        <ul>
          {topicList.map((uuid) => {
            const topic = topicMap[uuid];
            const topicClassName = topicUuid === uuid ? css.active : undefined;
            return (
              <li
                className={topicClassName}
                key={uuid}
                onClick={() => streamStore.setTopicUuid(uuid)}>
                <span className={css.icon}>
                  <Icon name="chat" size="small" />
                </span>
                <span className={css.label}>{topic.name}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

export default SideBar;
