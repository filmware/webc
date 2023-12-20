import { Button, Form, Input, message } from 'antd';
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import FormItem from '@/components/FormItem';
import Logo from '@/components/Logo';
import Root from '@/components/Root';
import { appPaths } from '@/routes';
import streamStore from '@/stores/stream';

import css from './SignIn.module.scss';

type FieldType = {
  email?: string;
  password?: string;
};

const INITIAL_VALUES: FieldType = {
  email: 'praj.ectowner@filmware.io',
  password: 'password',
};

function SignIn() {
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();

  const handleFormFinish = useCallback(async () => {
    const values = await form.validateFields();
    try {
      await streamStore.login(values.email, values.password);
      navigate(appPaths.app());
    } catch (e) {
      messageApi.open({ type: 'error', content: `Unable to login - ${(e as Error).message}` });
    }
  }, [form, messageApi, navigate]);

  return (
    <Root layout="center">
      <Form
        className={css.base}
        form={form}
        initialValues={INITIAL_VALUES}
        layout="vertical"
        onFinish={handleFormFinish}>
        <div className={css.logo}>
          <Logo showLabel />
        </div>
        <FormItem<FieldType>
          name="email"
          rules={[{ required: true, message: 'An email is required' }]}>
          <Input allowClear placeholder="email" />
        </FormItem>
        <FormItem<FieldType>
          name="password"
          rules={[{ required: true, message: 'Password is required' }]}>
          <Input.Password allowClear placeholder="password" />
        </FormItem>
        <Button block htmlType="submit" type="primary">
          Sign In
        </Button>
        {contextHolder}
      </Form>
    </Root>
  );
}

export default SignIn;
