import React, { useState, useEffect, useRef } from 'react';
import { AiOutlineSetting } from 'react-icons/ai';
import { BsTextWrap } from 'react-icons/bs';
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
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

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
    <div className={styles.settingsButton} ref={dropdownRef}>
      <button className={styles.settingsToggle} onClick={toggleDropdown} title="显示设置">
        <AiOutlineSetting />
      </button>

      {isOpen && settingItems.length > 0 && (
        <div className={styles.settingsDropdown}>
          {settingItems.map((item) => (
            <div key={item.key} className={styles.settingItem}>
              <button
                className={`${styles.toggleButton} ${item.active ? styles.active : ''}`}
                onClick={item.onClick}
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
      )}
    </div>
  );
};

export default SettingsButton;
