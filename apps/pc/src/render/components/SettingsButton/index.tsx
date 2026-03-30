import React, { useState, useRef } from 'react';
import { AiOutlineSetting } from 'react-icons/ai';
import { BsTextWrap } from 'react-icons/bs';
import Popover from '../Popover';
import Tooltip from '../Tooltip';
import styles from './styles.module.scss';

export interface SettingsToggleItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  active?: boolean;
  onClick: () => void;
}

interface SettingsButtonProps {
  wordWrap?: boolean;
  onToggleWordWrap?: (wrap: boolean) => void;
  items?: SettingsToggleItem[];
}

const SettingsButton: React.FC<SettingsButtonProps> = ({
  wordWrap,
  onToggleWordWrap,
  items = [],
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const toggleDropdown = () => {
    setIsOpen(!isOpen);
  };

  const handleToggleWordWrap = () => {
    if (typeof wordWrap !== 'boolean' || !onToggleWordWrap) {
      return;
    }
    onToggleWordWrap(!wordWrap);
  };

  const settingItems = [
    ...(typeof wordWrap === 'boolean' && onToggleWordWrap
      ? [
          {
            key: 'word-wrap',
            label: '自动换行',
            icon: <BsTextWrap />,
            active: wordWrap,
            onClick: handleToggleWordWrap,
          },
        ]
      : []),
    ...items,
  ];

  return (
    <div className={styles.settingsButton}>
      <Tooltip content="显示设置" position="bottom">
        <button
          ref={buttonRef}
          className={styles.settingsToggle}
          onClick={toggleDropdown}
          aria-label="显示设置"
        >
          <AiOutlineSetting />
        </button>
      </Tooltip>

      <Popover
        open={isOpen && settingItems.length > 0}
        anchorRef={buttonRef}
        placement="bottom"
        align="end"
        offset={8}
        zIndex={1000}
        className={styles.settingsDropdown}
        role="dialog"
        onClose={() => setIsOpen(false)}
        closeOnOutsideClick
        closeOnEscape
      >
        <div>
          {settingItems.map((item) => (
            <div key={item.key} className={styles.settingItem}>
              <button
                className={`${styles.toggleButton} ${item.active ? styles.active : ''}`}
                onClick={() => {
                  item.onClick();
                  setIsOpen(false);
                }}
              >
                {item.icon}
                <span>{item.label}</span>
                <div className={styles.toggle}>
                  <div className={styles.toggleSlider}></div>
                </div>
              </button>
            </div>
          ))}
        </div>
      </Popover>
    </div>
  );
};

export default SettingsButton;
