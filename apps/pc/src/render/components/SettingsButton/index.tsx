import React, { useState, useRef } from 'react';
import { AiOutlineSetting } from 'react-icons/ai';
import { BsTextWrap } from 'react-icons/bs';
import Popover from '../Popover';
import Tooltip from '../Tooltip';
import styles from './styles.module.scss';

export interface SettingsMenuItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  active?: boolean;
  kind?: 'toggle' | 'action';
  hint?: string;
  onClick: () => void;
}

interface SettingsButtonProps {
  wordWrap?: boolean;
  onToggleWordWrap?: (wrap: boolean) => void;
  items?: SettingsMenuItem[];
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

  const settingItems: SettingsMenuItem[] = [
    ...(typeof wordWrap === 'boolean' && onToggleWordWrap
      ? [
          {
            key: 'word-wrap',
            label: '自动换行',
            icon: <BsTextWrap />,
            active: wordWrap,
            kind: 'toggle' as const,
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
              {item.kind === 'action' ? (
                <button
                  className={styles.actionButton}
                  onClick={() => {
                    item.onClick();
                    setIsOpen(false);
                  }}
                >
                  {item.icon}
                  <span className={styles.itemText}>
                    <span className={styles.itemLabel}>{item.label}</span>
                    {item.hint ? <span className={styles.itemHint}>{item.hint}</span> : null}
                  </span>
                </button>
              ) : (
                <button
                  className={`${styles.toggleButton} ${item.active ? styles.active : ''}`}
                  onClick={() => {
                    item.onClick();
                    setIsOpen(false);
                  }}
                >
                  {item.icon}
                  <span className={styles.itemText}>
                    <span className={styles.itemLabel}>{item.label}</span>
                    {item.hint ? <span className={styles.itemHint}>{item.hint}</span> : null}
                  </span>
                  <div className={styles.toggle}>
                    <div className={styles.toggleSlider}></div>
                  </div>
                </button>
              )}
            </div>
          ))}
        </div>
      </Popover>
    </div>
  );
};

export default SettingsButton;
