import { ExclamationCircleFilled } from '@ant-design/icons';
import { Modal as AntdModal, Button } from 'antd';
import {
  createContext,
  CSSProperties,
  Dispatch,
  PropsWithChildren,
  ReactNode,
  SetStateAction,
  useCallback,
  useContext,
  useState,
} from 'react';

import css from './Modal.module.scss';

type ModalContext = {
  isOpen: boolean;
  setIsOpen: Dispatch<SetStateAction<boolean>>;
};

type OkParams = {
  disabled?: boolean;
  onClick?: () => Promise<void> | void;
  onError?: (e: Error) => Promise<void> | void;
  onSuccess?: () => Promise<void> | void;
  text?: string;
};

type Size = 'small' | 'medium' | 'large' | 'full';

export type ModalProps = {
  altOkParams?: OkParams;
  cancel?: boolean;
  cancelText?: string;
  danger?: boolean;
  key?: string;
  okParams?: OkParams;
  onClose?: () => Promise<void> | void;
  showCancel?: boolean;
  size?: Size;
  style?: CSSProperties;
  title?: ReactNode;
};

const DEFAULT_ALT_OK_TEXT = 'Alternative Ok';
const DEFAULT_CANCEL_TEXT = 'Cancel';
const DEFAULT_OK_TEXT = 'Ok';

const SIZE_TO_WIDTH: Record<Size, number | string | undefined> = {
  full: '100%',
  large: 1024,
  medium: 640,
  small: undefined,
};

export const ModalContext = createContext<ModalContext | null>(null);

function Modal({
  altOkParams,
  cancel = true,
  cancelText = DEFAULT_CANCEL_TEXT,
  children,
  danger,
  key,
  okParams,
  onClose,
  size = 'small',
  style,
  title,
}: PropsWithChildren<ModalProps>) {
  const [isWaiting, setIsWaiting] = useState(false);

  const modalContext = useContext(ModalContext);
  if (modalContext === null) throw new Error('Modal used outside of ModalContext.');

  const handleCancel = useCallback(() => {
    modalContext.setIsOpen(false);
  }, [modalContext]);

  const handleOk = useCallback(
    (config: OkParams) => async () => {
      setIsWaiting(true);
      try {
        await config?.onClick?.();
        await config?.onSuccess?.();
        modalContext.setIsOpen(false);
      } catch (e) {
        await config?.onError?.(e as Error);
      } finally {
        setIsWaiting(false);
      }
    },
    [modalContext],
  );

  /**
   * `forceRender` is required for modals with the `Form.useForm()` hook.
   * The form needs to render first in order for the resulting `form` reference
   * to be available.
   * https://stackoverflow.com/a/65641605/5402432
   */
  return (
    <AntdModal
      afterClose={onClose}
      closable={!isWaiting}
      footer={
        <div className={css.footer}>
          {cancel && (
            <Button disabled={isWaiting} type="link" onClick={handleCancel}>
              {cancelText}
            </Button>
          )}
          {altOkParams && (
            <Button
              danger={danger}
              disabled={altOkParams.disabled}
              loading={isWaiting}
              onClick={handleOk(altOkParams)}>
              {altOkParams?.text || DEFAULT_ALT_OK_TEXT}
            </Button>
          )}
          {okParams && (
            <Button
              danger={danger}
              disabled={okParams.disabled}
              loading={isWaiting}
              type="primary"
              onClick={handleOk(okParams)}>
              {okParams?.text || DEFAULT_OK_TEXT}
            </Button>
          )}
        </div>
      }
      forceRender
      key={key}
      maskClosable={!isWaiting}
      open={modalContext.isOpen}
      style={style}
      title={
        title && (
          <div className={css.title}>
            {danger && (
              <ExclamationCircleFilled style={{ color: 'var(--color-error)', fontSize: 24 }} />
            )}
            {title}
          </div>
        )
      }
      width={SIZE_TO_WIDTH[size]}
      onCancel={handleCancel}
      onOk={okParams && handleOk(okParams)}>
      {children}
    </AntdModal>
  );
}

export default Modal;
