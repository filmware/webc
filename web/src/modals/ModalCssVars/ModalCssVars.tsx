import { Descriptions, Input } from 'antd';
import { useEffect, useMemo, useState } from 'react';

import Modal from '@/components/Modal';

import css from './ModalCssVars.module.scss';

function renderRow(value: string) {
  const isColor = /^#[0-9a-f]{3,8}/i.test(value) || /^rgb/i.test(value);
  return (
    <div className={css.valueRow}>
      {isColor ? <div className={css.color} style={{ backgroundColor: value }} /> : null}
      {value}
    </div>
  );
}

function ModalCssVars() {
  const [keys, setKeys] = useState<string[]>([]);
  const [map, setMap] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');

  const items = useMemo(() => {
    return keys
      .filter((key) => new RegExp(search, 'i').test(key))
      .map((key) => ({ key, label: key, children: renderRow(map[key]) }));
  }, [keys, map, search]);

  useEffect(() => {
    const computedStyles = getComputedStyle(document.documentElement);

    const keys = Object.values(document.documentElement.style)
      .filter((key) => /^--[a-z]/i.test(key))
      .sort((a, b) => a.localeCompare(b));
    setKeys(keys);

    const map = keys.reduce((acc, key) => {
      return { ...acc, [key]: computedStyles.getPropertyValue(key) };
    }, {});
    setMap(map);
  }, []);

  return (
    <Modal cancel={false} style={{ top: 40 }} title="Current CSS Variables">
      <div className={css.base}>
        <Input
          allowClear
          placeholder={`search ${keys.length} CSS variables`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className={css.list}>
          <Descriptions bordered column={1} items={items} size="small" />
        </div>
      </div>
    </Modal>
  );
}

export default ModalCssVars;
