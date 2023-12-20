import { Form, FormItemProps } from 'antd';
import { PropsWithChildren } from 'react';

import css from './FormItem.module.scss';

export type Props = FormItemProps;

function FormItem<T>({ children, name, ...props }: PropsWithChildren<Props>) {
  return (
    <Form.Item<T> className={css.base} name={name} {...props}>
      {props.id ? <div id={props.id}>{children}</div> : children}
    </Form.Item>
  );
}

export default FormItem;
