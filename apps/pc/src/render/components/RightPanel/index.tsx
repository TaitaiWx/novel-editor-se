import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  extractOutline,
  extractActs,
  type OutlineNode,
  type ActNode,
} from '@novel-editor/basic-algorithm';
import styles from './styles.module.scss';

type TabType = 'outline' | 'characters' | 'acts';

interface RightPanelProps {
  content: string;
  collapsed: boolean;
  onToggle: () => void;
  onScrollToLine?: (line: number) => void;
}

const TAB_LABELS: Record<TabType, string> = {
  outline: '大纲',
  characters: '人物',
  acts: '幕剧',
};

const TAB_KEYS = Object.keys(TAB_LABELS) as TabType[];

const RightPanel: React.FC<RightPanelProps> = ({
  content,
  collapsed,
  onToggle,
  onScrollToLine,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('outline');

  const handleTabClick = useCallback((tab: TabType) => {
    setActiveTab(tab);
  }, []);

  if (collapsed) {
    return (
      <div className={styles.collapsedPanel}>
        <button className={styles.expandButton} onClick={onToggle} title="展开面板">
          ◀
        </button>
      </div>
    );
  }

  return (
    <div className={styles.rightPanel}>
      <div className={styles.panelHeader}>
        <div className={styles.tabs}>
          {TAB_KEYS.map((tab) => (
            <button
              key={tab}
              className={`${styles.tab} ${activeTab === tab ? styles.active : ''}`}
              onClick={() => handleTabClick(tab)}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
        <button className={styles.collapseButton} onClick={onToggle} title="折叠面板">
          ▶
        </button>
      </div>
      <div className={styles.panelContent}>
        {activeTab === 'outline' && (
          <OutlineView content={content} onScrollToLine={onScrollToLine} />
        )}
        {activeTab === 'characters' && <CharactersView />}
        {activeTab === 'acts' && <ActsView content={content} onScrollToLine={onScrollToLine} />}
      </div>
    </div>
  );
};

// ---------- Outline View ----------

const OutlineView: React.FC<{ content: string; onScrollToLine?: (line: number) => void }> =
  React.memo(({ content, onScrollToLine }) => {
    const [activeIndex, setActiveIndex] = useState<number | null>(null);

    const headings: OutlineNode[] = useMemo(() => extractOutline(content), [content]);

    if (!content) {
      return <div className={styles.emptyHint}>打开文件后查看大纲</div>;
    }

    if (headings.length === 0) {
      return (
        <div className={styles.emptyHint}>
          未检测到标题结构
          <br />
          <span className={styles.hintSub}>支持 Markdown 标题、中文章节标记、数字编号等格式</span>
        </div>
      );
    }

    return (
      <div className={styles.outlineTree}>
        {headings.map((h, i) => {
          const indent = (h.level - 1) * 18;
          const isActive = activeIndex === i;
          return (
            <div
              key={i}
              className={`${styles.outlineNode} ${isActive ? styles.outlineNodeActive : ''}`}
              onClick={() => {
                setActiveIndex(i);
                onScrollToLine?.(h.line);
              }}
            >
              <div className={styles.outlineNodeContent} style={{ paddingLeft: `${indent}px` }}>
                <div className={styles.outlineDotWrapper}>
                  <span
                    className={`${styles.outlineDot} ${isActive ? styles.outlineDotActive : ''}`}
                  />
                  {i < headings.length - 1 && <div className={styles.outlineConnectorLine} />}
                </div>
                <span className={styles.outlineText}>{h.text}</span>
                <span className={styles.outlineLineNum}>L{h.line}</span>
              </div>
            </div>
          );
        })}
      </div>
    );
  });

// ---------- Characters View ----------

interface Character {
  name: string;
  role: string;
  description: string;
  avatar?: string; // data URL or file path
}

const ROLE_COLORS: Record<string, string> = {
  主角: '#4ec9b0',
  配角: '#9cdcfe',
  反派: '#f14c4c',
  导师: '#dcdcaa',
  盟友: '#c586c0',
};

function getRoleColor(role: string): string {
  if (ROLE_COLORS[role]) return ROLE_COLORS[role];
  for (const key of Object.keys(ROLE_COLORS)) {
    if (role.includes(key)) return ROLE_COLORS[key];
  }
  return '#007acc';
}

// Memoized character card to avoid inline drag handler recreation
const CharacterCard: React.FC<{
  character: Character;
  index: number;
  dragIndex: number | null;
  dropIndex: number | null;
  onDragStart: (e: React.DragEvent<HTMLDivElement>, index: number) => void;
  onDragEnd: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>, index: number) => void;
  onDragEnter: (e: React.DragEvent<HTMLDivElement>, index: number) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>, index: number) => void;
  onDelete: (index: number) => void;
}> = React.memo(
  ({
    character: c,
    index: i,
    dragIndex,
    dropIndex,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDragEnter,
    onDragLeave,
    onDrop,
    onDelete,
  }) => {
    const roleColor = useMemo(() => (c.role ? getRoleColor(c.role) : null), [c.role]);
    const truncDesc = useMemo(
      () => (c.description.length > 80 ? c.description.slice(0, 80) + '...' : c.description),
      [c.description]
    );

    return (
      <React.Fragment>
        {dropIndex === i && dragIndex !== null && dragIndex > i && (
          <div className={styles.dropIndicator} />
        )}
        <div
          className={`${styles.characterCard} ${dragIndex === i ? styles.dragging : ''}`}
          draggable={true}
          onDragStart={(e) => onDragStart(e, i)}
          onDragEnd={onDragEnd}
          onDragOver={(e) => onDragOver(e, i)}
          onDragEnter={(e) => onDragEnter(e, i)}
          onDragLeave={onDragLeave}
          onDrop={(e) => onDrop(e, i)}
        >
          <div className={styles.cardBody}>
            {c.avatar && (
              <img src={c.avatar} alt={c.name} className={styles.cardAvatar} draggable={false} />
            )}
            <div className={styles.cardInfo}>
              <div className={styles.cardHeader}>
                <span className={styles.dragHandle}>⠿</span>
                <span className={styles.cardName}>{c.name}</span>
                {roleColor && (
                  <span
                    className={styles.cardRole}
                    style={{
                      backgroundColor: `${roleColor}1a`,
                      color: roleColor,
                    }}
                  >
                    {c.role}
                  </span>
                )}
                <button
                  className={styles.deleteCardButton}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(i);
                  }}
                  title="删除角色"
                >
                  ×
                </button>
              </div>
              {c.description && <div className={styles.cardDesc}>{truncDesc}</div>}
            </div>
          </div>
        </div>
        {dropIndex === i && dragIndex !== null && dragIndex < i && (
          <div className={styles.dropIndicator} />
        )}
      </React.Fragment>
    );
  }
);

const CharactersView: React.FC = React.memo(() => {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newAvatar, setNewAvatar] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dragCounter = useRef(0);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setNewAvatar(reader.result as string);
    reader.readAsDataURL(file);
  }, []);

  const handleAdd = useCallback(() => {
    if (!newName.trim()) return;
    setCharacters((prev) => [
      ...prev,
      {
        name: newName.trim(),
        role: newRole.trim(),
        description: newDesc.trim(),
        avatar: newAvatar || undefined,
      },
    ]);
    setNewName('');
    setNewRole('');
    setNewDesc('');
    setNewAvatar('');
    setAdding(false);
  }, [newName, newRole, newDesc, newAvatar]);

  const handleDelete = useCallback((index: number) => {
    setCharacters((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleDragStart = useCallback((e: React.DragEvent<HTMLDivElement>, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
    const target = e.currentTarget;
    requestAnimationFrame(() => {
      target.style.opacity = '0.5';
    });
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.currentTarget.style.opacity = '1';
    setDragIndex(null);
    setDropIndex(null);
    dragCounter.current = 0;
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>, index: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dragIndex === null || dragIndex === index) return;
      setDropIndex(index);
    },
    [dragIndex]
  );

  const handleDragEnter = useCallback(
    (e: React.DragEvent<HTMLDivElement>, index: number) => {
      e.preventDefault();
      dragCounter.current += 1;
      if (dragIndex === null || dragIndex === index) return;
      setDropIndex(index);
    },
    [dragIndex]
  );

  const handleDragLeave = useCallback(() => {
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      setDropIndex(null);
      dragCounter.current = 0;
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>, targetIndex: number) => {
      e.preventDefault();
      dragCounter.current = 0;
      if (dragIndex === null || dragIndex === targetIndex) {
        setDragIndex(null);
        setDropIndex(null);
        return;
      }
      setCharacters((prev) => {
        const updated = [...prev];
        const [moved] = updated.splice(dragIndex, 1);
        updated.splice(targetIndex, 0, moved);
        return updated;
      });
      setDragIndex(null);
      setDropIndex(null);
    },
    [dragIndex]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleAdd();
      }
    },
    [handleAdd]
  );

  const toggleAdding = useCallback(() => {
    setAdding((prev) => !prev);
  }, []);

  return (
    <div className={styles.charactersList}>
      <div className={styles.sectionHeader}>
        <span>角色列表</span>
        <button className={styles.addButton} onClick={toggleAdding}>
          {adding ? '取消' : '+ 添加'}
        </button>
      </div>

      {adding && (
        <div className={styles.addForm}>
          <div className={styles.avatarPickerRow}>
            <div
              className={styles.avatarPicker}
              onClick={() => avatarInputRef.current?.click()}
              title="点击选择角色图片"
            >
              {newAvatar ? (
                <img src={newAvatar} alt="avatar" className={styles.avatarPreview} />
              ) : (
                <span className={styles.avatarPlaceholder}>+</span>
              )}
            </div>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarSelect}
              style={{ display: 'none' }}
            />
            <span className={styles.avatarHint}>角色头像</span>
          </div>
          <input
            placeholder="角色名称"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={handleKeyDown}
            className={styles.formInput}
            autoFocus
          />
          <input
            placeholder="角色定位 (主角/配角/反派...)"
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            onKeyDown={handleKeyDown}
            className={styles.formInput}
          />
          <textarea
            placeholder="角色描述、设定..."
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            className={styles.formTextarea}
            rows={3}
          />
          <button className={styles.submitButton} onClick={handleAdd}>
            确认添加
          </button>
        </div>
      )}

      {characters.length === 0 && !adding && (
        <div className={styles.emptyHint}>
          暂无角色
          <br />
          <span className={styles.hintSub}>点击添加按钮创建角色卡片</span>
        </div>
      )}

      <div className={styles.cardsContainer}>
        {characters.map((c, i) => (
          <CharacterCard
            key={`${c.name}-${i}`}
            character={c}
            index={i}
            dragIndex={dragIndex}
            dropIndex={dropIndex}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onDelete={handleDelete}
          />
        ))}
        {dropIndex !== null && dragIndex !== null && dropIndex >= characters.length && (
          <div className={styles.dropIndicator} />
        )}
      </div>
    </div>
  );
});

// ---------- Acts View ----------

const ACT_COLORS = ['#007acc', '#4ec9b0', '#c586c0', '#dcdcaa', '#9cdcfe', '#f14c4c'];

const ActsView: React.FC<{ content: string; onScrollToLine?: (line: number) => void }> = React.memo(
  ({ content, onScrollToLine }) => {
    const [activeAct, setActiveAct] = useState<number | null>(null);
    const [activeScene, setActiveScene] = useState<string | null>(null);

    const acts: ActNode[] = useMemo(() => extractActs(content), [content]);

    const handleActClick = useCallback(
      (actIdx: number, line: number) => {
        setActiveAct((prev) => (prev === actIdx ? null : actIdx));
        onScrollToLine?.(line);
      },
      [onScrollToLine]
    );

    const handleSceneClick = useCallback(
      (e: React.MouseEvent, sceneKey: string, line: number) => {
        e.stopPropagation();
        setActiveScene((prev) => (prev === sceneKey ? null : sceneKey));
        onScrollToLine?.(line);
      },
      [onScrollToLine]
    );

    if (!content) {
      return <div className={styles.emptyHint}>打开文件后查看幕剧结构</div>;
    }

    if (acts.length === 0) {
      return (
        <div className={styles.emptyHint}>
          未检测到幕剧结构
          <br />
          <span className={styles.hintSub}>支持格式: 第一幕、第一场、## ACT I 等</span>
        </div>
      );
    }

    return (
      <div className={styles.actsFlow}>
        {acts.map((act, actIdx) => {
          const color = ACT_COLORS[actIdx % ACT_COLORS.length];
          const isActActive = activeAct === actIdx;
          return (
            <div key={actIdx} className={styles.actNode}>
              {actIdx > 0 && <div className={styles.actConnector} />}

              <div
                className={`${styles.actCard} ${isActActive ? styles.actCardActive : ''}`}
                style={{ borderLeftColor: color }}
                onClick={() => handleActClick(actIdx, act.line)}
              >
                <div className={styles.actHeader}>
                  <div className={styles.actDot} style={{ backgroundColor: color }} />
                  <span className={styles.actTitle}>{act.title}</span>
                  <span className={styles.actLineNum}>L{act.line}</span>
                </div>

                {act.scenes.length > 0 && (
                  <div className={styles.scenesFlow}>
                    {act.scenes.map((scene, sceneIdx) => {
                      const sceneKey = `${actIdx}-${sceneIdx}`;
                      const isSceneActive = activeScene === sceneKey;
                      return (
                        <div key={sceneIdx} className={styles.sceneNode}>
                          <div className={styles.sceneConnectorWrapper}>
                            <div
                              className={styles.sceneConnectorDot}
                              style={{ borderColor: color }}
                            />
                            {sceneIdx < act.scenes.length - 1 && (
                              <div className={styles.sceneConnectorLine} />
                            )}
                          </div>

                          <div
                            className={`${styles.sceneCard} ${isSceneActive ? styles.sceneCardActive : ''}`}
                            onClick={(e) => handleSceneClick(e, sceneKey, scene.line)}
                          >
                            <div className={styles.sceneHeader}>
                              <span className={styles.sceneTitle}>{scene.title}</span>
                              <span className={styles.sceneLineNum}>L{scene.line}</span>
                            </div>
                            {scene.preview && (
                              <div className={styles.scenePreview}>{scene.preview}</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {act.scenes.length === 0 && <div className={styles.noScenes}>暂无场景</div>}
              </div>
            </div>
          );
        })}
      </div>
    );
  }
);

export default RightPanel;
