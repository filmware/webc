import { Form, Segmented } from 'antd';
import { useObservable } from 'micro-observables';

import Drawer from '@/components/Drawer';
import FormItem from '@/components/FormItem';
import themeStore, { Mode } from '@/stores/theme';

import css from './DrawerSettings.module.scss';

export type Props = {
  open?: boolean;
  onClose?: () => void;
};

type FieldType = {
  mode: Mode;
};

const MODE_OPTIONS = [
  { label: 'System Default', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
];

function DrawerSettings({ open, onClose }: Props) {
  const userMode = useObservable(themeStore.userMode);

  return (
    <Drawer open={open} title="Settings" onClose={onClose}>
      <Form className={css.base} colon={false}>
        <FormItem<FieldType> label="Theme" name="mode">
          <Segmented
            options={MODE_OPTIONS}
            value={userMode}
            onChange={(v) => themeStore.setUserMode(v as Mode)}
          />
        </FormItem>
      </Form>
    </Drawer>
  );
}

export default DrawerSettings;
