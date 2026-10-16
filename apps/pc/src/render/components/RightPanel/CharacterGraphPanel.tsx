import UiButton from '@novel-editor/ui/Button';
import React, { useEffect, useRef, useState } from 'react';
import { VscRefresh, VscClose } from 'react-icons/vsc';
import CharacterAvatar from '../CharacterAvatar';
import ContextMenu from '@novel-editor/ui/ContextMenu';
import Popover from '@novel-editor/ui/Popover';
import Tooltip from '@novel-editor/ui/Tooltip';
import type { Character, CharacterRelation } from './types';
import { RELATION_TONE_LABELS, RELATION_TONE_COLORS } from './constants';
import RelationEditor, { type RelationEditorProps } from './CharacterGraph/RelationEditor';
import styles from './CharacterGraph/styles.module.scss';
import GraphPortrait from './CharacterGraph/GraphPortrait';

interface CharacterGraphPanelProps extends RelationEditorProps {
  links: CharacterRelation[];
  draftRelationIds?: string[];
  characterPositions: Array<{ character: Character; x: number; y: number }>;
  selectedCharacterId: number | null;
  /** 当前详情页所属人物，区别于图谱里临时选中的节点。 */
  currentCharacterId?: number | null;
  onSelectCharacter: (id: number | null) => void;
  onOpenCharacter?: (id: number) => void;
  onResetLayout?: () => void;
  consumeGraphDrag?: () => boolean;
  inspectorRef?: React.RefObject<HTMLDivElement>;
  workPath?: string | null;
  onGraphNodeMouseDown: (e: React.MouseEvent<HTMLButtonElement>, id: number) => void;
  onStartEditRelation: (relation: CharacterRelation) => void;
  onCancelEditRelation: () => void;
  onEditorStateChange?: (editing: boolean) => void;
}

/** 图谱内的人物菜单和关系编辑器按需出现，避免重复展示关系列表。 */
export const CharacterGraphPanel = React.memo(function CharacterGraphPanel(
  props: CharacterGraphPanelProps
) {
  const {
    characters,
    links,
    draftRelationIds = [],
    characterPositions,
    selectedCharacterId,
    currentCharacterId = null,
    onSelectCharacter,
    onOpenCharacter,
    onResetLayout,
    consumeGraphDrag,
    inspectorRef,
    workPath,
    onGraphNodeMouseDown,
    onStartEditRelation,
    onCancelEditRelation,
    onEditorStateChange,
  } = props;
  const toolbarRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 720, height: 420 });
  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width && height)
        setCanvasSize((previous) =>
          previous.width === width && previous.height === height ? previous : { width, height }
        );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [characters.length]);
  const [menu, setMenu] = useState<{ id: number; x: number; y: number } | null>(null);
  const [propertyId, setPropertyId] = useState<number | null>(null);
  const [propertyAnchor, setPropertyAnchor] = useState<DOMRect | null>(null);
  const [hoverNode, setHoverNode] = useState<number | null>(null);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<number | 'pick' | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [creating, setCreating] = useState(false);
  const editing = creating || props.editingRelationId !== null;
  useEffect(() => {
    onEditorStateChange?.(editing);
    return () => onEditorStateChange?.(false);
  }, [editing, onEditorStateChange]);
  const propertyCharacter = characters.find((character) => character.id === propertyId);
  const sourcePosition = characterPositions.find(
    (position) => position.character.id === connectFrom
  );
  const hoveredRelation = links.find((link) => link.id === hoverEdge);
  const resetConnection = () => {
    setConnectFrom(null);
    setPointer(null);
  };
  useEffect(() => {
    if (connectFrom === null) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setConnectFrom(null);
        setPointer(null);
      }
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [connectFrom]);
  const closeEditor = () => {
    setCreating(false);
    onCancelEditRelation();
  };
  const startConnecting = (id: number | 'pick') => {
    consumeGraphDrag?.();
    setPropertyId(null);
    setMenu(null);
    setPointer(null);
    setConnectFrom(id);
  };
  const selectNode = (id: number) => {
    if (consumeGraphDrag?.() || editing) return;
    onSelectCharacter(id);
    if (connectFrom === 'pick') {
      setConnectFrom(id);
      return;
    }
    if (typeof connectFrom !== 'number' || connectFrom === id) return;
    const existing = links.find(
      (link) =>
        (link.sourceId === connectFrom && link.targetId === id) ||
        (link.targetId === connectFrom && link.sourceId === id)
    );
    if (existing) onStartEditRelation(existing);
    else {
      onCancelEditRelation();
      props.onRelationSourceChange(connectFrom);
      props.onRelationTargetChange(id);
      setCreating(true);
    }
    resetConnection();
  };
  const editLink = (link: CharacterRelation) => {
    if (editing) return;
    resetConnection();
    setMenu(null);
    setPropertyId(null);
    onStartEditRelation(link);
  };
  const showMenu = (id: number, x: number, y: number, anchor: DOMRect) => {
    if (editing) return;
    onSelectCharacter(id);
    setPropertyId(null);
    setPropertyAnchor(anchor);
    setMenu({ id, x, y });
  };
  const isEmphasizedNode = (id: number) =>
    hoverNode === id ||
    (hoveredRelation && (hoveredRelation.sourceId === id || hoveredRelation.targetId === id));
  return (
    <div ref={inspectorRef} className={styles.panel}>
      <div ref={toolbarRef} className={styles.toolbar}>
        <div className={styles.actions}>
          <strong>人物图谱</strong>
          <span>
            {characters.length} 个人物，{links.length} 条关系
            {draftRelationIds.length > 0 && `（${draftRelationIds.length} 条待保存）`}
          </span>
          {onResetLayout && (
            <Tooltip content="重新排布人物">
              <UiButton
                unstyled
                type="button"
                aria-label="重新排布人物"
                disabled={editing}
                onClick={onResetLayout}
              >
                <VscRefresh />
              </UiButton>
            </Tooltip>
          )}
        </div>
      </div>
      <div className={styles.hint}>
        {connectFrom !== null ? (
          <>
            <span>
              {connectFrom === 'pick'
                ? '选择关系的第一个人物'
                : `从「${sourcePosition?.character.name || ''}」连向另一人物，点击目标后填写关系`}
            </span>
            <UiButton unstyled type="button" onClick={resetConnection}>
              <VscClose />
              取消连线
            </UiButton>
          </>
        ) : (
          '拖动人物调整位置，双击查看属性，右键建立关系，点击连线编辑关系'
        )}
      </div>
      {characters.length === 0 ? (
        <div className={styles.empty}>添加人物后，在这里建立关系。</div>
      ) : (
        <div className={styles.viewport}>
          <div
            ref={canvasRef}
            className={`${styles.canvas} ${connectFrom !== null ? styles.connecting : ''}`}
            style={{ height: characters.length > 8 ? Math.ceil(characters.length / 4) * 168 : 420 }}
            onMouseMove={(event) => {
              if (connectFrom === null) return;
              const rect = event.currentTarget.getBoundingClientRect();
              setPointer({
                x: ((event.clientX - rect.left) * 360) / rect.width,
                y: ((event.clientY - rect.top) * 240) / rect.height,
              });
            }}
            onMouseLeave={() => setPointer(null)}
          >
            <svg className={styles.edges} aria-label="人物关系连线">
              {links.map((link) => {
                const source = characterPositions.find(
                  (position) => position.character.id === link.sourceId
                );
                const target = characterPositions.find(
                  (position) => position.character.id === link.targetId
                );
                if (!source || !target) return null;
                const hovered =
                  hoverEdge === link.id ||
                  hoverNode === link.sourceId ||
                  hoverNode === link.targetId;
                const active =
                  hovered ||
                  selectedCharacterId === link.sourceId ||
                  selectedCharacterId === link.targetId;
                const dim = (hoverNode !== null || hoverEdge !== null) && !hovered;
                const sx = (source.x / 360) * canvasSize.width;
                const sy = (source.y / 240) * canvasSize.height;
                const tx = (target.x / 360) * canvasSize.width;
                const ty = (target.y / 240) * canvasSize.height;
                const length = Math.hypot(tx - sx, ty - sy) || 1;
                const bend = Math.min(28, length * 0.08);
                const cx = (sx + tx) / 2 - ((ty - sy) / length) * bend;
                const cy = (sy + ty) / 2 + ((tx - sx) / length) * bend;
                const curve = `M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`;
                const label = RELATION_TONE_LABELS[link.tone] ?? RELATION_TONE_LABELS.other;
                return (
                  <g
                    key={link.id}
                    style={
                      {
                        '--relation-color':
                          RELATION_TONE_COLORS[link.tone] ?? RELATION_TONE_COLORS.other,
                      } as React.CSSProperties
                    }
                    role="button"
                    tabIndex={editing ? -1 : 0}
                    className={`${styles.edge} ${active ? styles.edgeActive : ''} ${hovered ? styles.edgeHovered : ''} ${dim ? styles.dimmed : ''} ${draftRelationIds.includes(link.id) ? styles.edgeDraft : ''}`}
                    aria-label={`编辑关系：${source.character.name}、${target.character.name}，${label}`}
                    onMouseEnter={() => setHoverEdge(link.id)}
                    onMouseLeave={() => setHoverEdge(null)}
                    onFocus={() => setHoverEdge(link.id)}
                    onBlur={() => setHoverEdge(null)}
                    onClick={() => editLink(link)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        editLink(link);
                      }
                    }}
                  >
                    <title>
                      {source.character.name} ↔ {target.character.name}：{label}
                      {link.note ? `：${link.note}` : ''}
                    </title>
                    <path d={curve} className={styles.edgeHit} />
                    <path d={curve} className={styles.edgeLine} />
                    <path d={curve} className={styles.edgeFlow} aria-hidden="true" />
                    <text
                      x={(sx + 2 * cx + tx) / 4}
                      y={(sy + 2 * cy + ty) / 4}
                      dy={-10}
                      textAnchor="middle"
                      className={styles.edgeLabel}
                    >
                      {hovered || label.length <= 12 ? label : `${label.slice(0, 12)}…`}
                    </text>
                  </g>
                );
              })}
              {sourcePosition && pointer && (
                <line
                  x1={`${sourcePosition.x / 3.6}%`}
                  y1={`${sourcePosition.y / 2.4}%`}
                  x2={`${pointer.x / 3.6}%`}
                  y2={`${pointer.y / 2.4}%`}
                  className={styles.previewLine}
                />
              )}
            </svg>
            {characterPositions.map(({ character, x, y }, index) => (
              <UiButton
                unstyled
                type="button"
                key={character.id}
                className={`${styles.node} ${selectedCharacterId === character.id ? styles.selected : ''} ${isEmphasizedNode(character.id) ? styles.emphasized : ''} ${connectFrom === character.id ? styles.source : ''}`}
                style={
                  {
                    left: `${x / 3.6}%`,
                    top: `${y / 2.4}%`,
                    '--node-delay': `${Math.min(index, 8) * 45}ms`,
                  } as React.CSSProperties
                }
                aria-label={`${character.name}，右键查看属性或建立关系`}
                aria-pressed={selectedCharacterId === character.id}
                onMouseEnter={() => setHoverNode(character.id)}
                onMouseLeave={() => setHoverNode(null)}
                onFocus={() => setHoverNode(character.id)}
                onBlur={() => setHoverNode(null)}
                onClick={() => selectNode(character.id)}
                onDoubleClick={(event) => {
                  if (editing || connectFrom !== null || consumeGraphDrag?.()) return;
                  setMenu(null);
                  setPropertyAnchor(event.currentTarget.getBoundingClientRect());
                  setPropertyId(character.id);
                }}
                onMouseDown={(event) => {
                  if (connectFrom === null && !editing) onGraphNodeMouseDown(event, character.id);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  showMenu(
                    character.id,
                    event.clientX,
                    event.clientY,
                    event.currentTarget.getBoundingClientRect()
                  );
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                    event.preventDefault();
                    const rect = event.currentTarget.getBoundingClientRect();
                    showMenu(character.id, rect.right, rect.bottom, rect);
                  }
                }}
              >
                <GraphPortrait character={character} workPath={workPath} />
                <span className={styles.nodeName}>{character.name}</span>
              </UiButton>
            ))}
          </div>
        </div>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: '人物属性', onClick: () => setPropertyId(menu.id) },
            {
              label: '从此人物建立关系',
              disabled: characters.length < 2,
              onClick: () => startConnecting(menu.id),
            },
          ]}
        />
      )}
      <Popover
        open={!!propertyCharacter}
        anchorRect={propertyAnchor}
        onClose={() => setPropertyId(null)}
        closeOnOutsideClick
        closeOnEscape
        className={styles.popover}
      >
        {propertyCharacter && (
          <div className={styles.properties}>
            <header>
              <CharacterAvatar
                name={propertyCharacter.name}
                avatar={propertyCharacter.avatar}
                workPath={workPath}
                color={propertyCharacter.highlightColor}
                size={48}
              />
              <div>
                <strong>{propertyCharacter.name}</strong>
                <p>{propertyCharacter.role || '暂无角色定位'}</p>
              </div>
            </header>
            <p className={styles.propertyDescription}>
              {propertyCharacter.description?.trim() || '暂无人物简介'}
            </p>
            <footer>
              <span className={styles.relationCount}>
                {
                  links.filter(
                    (link) =>
                      link.sourceId === propertyCharacter.id ||
                      link.targetId === propertyCharacter.id
                  ).length
                }{' '}
                条关系
              </span>
              {onOpenCharacter && propertyCharacter.id !== currentCharacterId && (
                <UiButton
                  unstyled
                  type="button"
                  onClick={() => {
                    onOpenCharacter(propertyCharacter.id);
                    setPropertyId(null);
                  }}
                >
                  编辑人物属性
                </UiButton>
              )}
              <UiButton
                unstyled
                type="button"
                disabled={characters.length < 2}
                onClick={() => startConnecting(propertyCharacter.id)}
              >
                建立关系
              </UiButton>
            </footer>
          </div>
        )}
      </Popover>
      <Popover open={editing} anchorRef={toolbarRef} align="end" className={styles.popover}>
        {editing && (
          <RelationEditor key={props.editingRelationId ?? 'new'} {...props} onClose={closeEditor} />
        )}
      </Popover>
    </div>
  );
});
