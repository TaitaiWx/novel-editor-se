import React, { useState, useEffect, useRef } from 'react';
import { AiOutlineSetting } from 'react-icons/ai';
import { BsGrid, BsTextLeft, BsTextWrap } from 'react-icons/bs';
import styles from './styles.module.scss';

interface SettingsButtonProps {
  showGrid: boolean;
  onToggleGrid: (show: boolean) => void;
  showRowLines: boolean;
  onToggleRowLines: (show: boolean) => void;
  wordWrap: boolean;
  onToggleWordWrap: (wrap: boolean) => void;
}

const SettingsButton: React.FC<SettingsButtonProps> = ({
  showGrid,
  onToggleGrid,
  showRowLines,
  onToggleRowLines,
  wordWrap,
  onToggleWordWrap,
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

  const handleToggleGrid = () => {
    onToggleGrid(!showGrid);
  };

  const handleToggleRowLines = () => {
    onToggleRowLines(!showRowLines);
  };

  const handleToggleWordWrap = () => {
    onToggleWordWrap(!wordWrap);
  };

  return (
    <div className={styles.settingsButton} ref={dropdownRef}>
      <button className={styles.settingsToggle} onClick={toggleDropdown} title="显示设置">
        <AiOutlineSetting />
      </button>

      {isOpen && (
        <div className={styles.settingsDropdown}>
          <div className={styles.settingItem}>
            <button
              className={`${styles.toggleButton} ${showGrid ? styles.active : ''}`}
              onClick={handleToggleGrid}
            >
              <BsGrid />
              <span>显示方格线</span>
              <div className={styles.toggle}>
                <div className={styles.toggleSlider}></div>
              </div>
            </button>
          </div>
          <div className={styles.settingItem}>
            <button
              className={`${styles.toggleButton} ${showRowLines ? styles.active : ''}`}
              onClick={handleToggleRowLines}
            >
              <BsTextLeft />
              <span>显示行线</span>
              <div className={styles.toggle}>
                <div className={styles.toggleSlider}></div>
              </div>
            </button>
          </div>
          <div className={styles.settingItem}>
            <button
              className={`${styles.toggleButton} ${wordWrap ? styles.active : ''}`}
              onClick={handleToggleWordWrap}
            >
              <BsTextWrap />
              <span>自动换行</span>
              <div className={styles.toggle}>
                <div className={styles.toggleSlider}></div>
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsButton;
