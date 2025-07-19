import React, { useState } from 'react';
import styles from './styles.module.scss';

interface InputDialogProps {
  isOpen: boolean;
  title: string;
  placeholder: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

const InputDialog: React.FC<InputDialogProps> = ({
  isOpen,
  title,
  placeholder,
  onConfirm,
  onCancel,
}) => {
  const [value, setValue] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) {
      onConfirm(value.trim());
      setValue('');
    }
  };

  const handleCancel = () => {
    setValue('');
    onCancel();
  };

  return (
    <div className={styles.inputDialogOverlay}>
      <div className={styles.inputDialog}>
        <h3>{title}</h3>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            autoFocus
          />
          <div className={styles.inputDialogButtons}>
            <button type="button" onClick={handleCancel}>
              取消
            </button>
            <button type="submit" disabled={!value.trim()}>
              确定
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default InputDialog;
