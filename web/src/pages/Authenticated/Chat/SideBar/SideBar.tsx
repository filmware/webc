import { Input } from 'antd';

import Icon from '@/components/Icon';

import css from './SideBar.module.scss';

function SideBar() {
  return (
    <div className={css.base}>
      <section className={css.search}>
        <Input allowClear placeholder="Search topics" />
      </section>
      <section>
        <h4>Topics</h4>
        <ul>
          <li>
            <Icon name="chat" size="small" />
            <span>Topic 1</span>
          </li>
          <li>
            <Icon name="chat" size="small" />
            <span>Topic 2</span>
          </li>
          <li>
            <Icon name="chat" size="small" />
            <span>Topic 3</span>
          </li>
          <li>
            <Icon name="chat" size="small" />
            <span>Topic 4</span>
          </li>
          <li>
            <Icon name="chat" size="small" />
            <span>Topic 5</span>
          </li>
        </ul>
      </section>
    </div>
  );
}

export default SideBar;
