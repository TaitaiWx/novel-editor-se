import React, { useMemo, useState } from 'react';
import {
  addLocation,
  recordVisit,
  removeLocation,
  type Atlas,
  type LocationRecord,
} from '@novel-editor/core/growth';
import styles from './styles.module.scss';

interface GrowthMapPanelProps {
  atlas: Atlas;
  characterNames: string[];
  selectedCharacter: string | null;
  busy: boolean;
  onSave: (atlas: Atlas) => Promise<string | null>;
}

function toChapter(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const num = Number(value);
  return Number.isInteger(num) && num >= 0 ? num : undefined;
}

/**
 * 地图记录：按区域分组的地点列表、到访足迹、新增地点 / 记录到访
 */
export const GrowthMapPanel: React.FC<GrowthMapPanelProps> = ({
  atlas,
  characterNames,
  selectedCharacter,
  busy,
  onSave,
}) => {
  const [name, setName] = useState('');
  const [region, setRegion] = useState('');
  const [parent, setParent] = useState('');
  const [description, setDescription] = useState('');
  const [visitLocation, setVisitLocation] = useState('');
  const [visitCharacter, setVisitCharacter] = useState(selectedCharacter ?? '');
  const [visitChapter, setVisitChapter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, LocationRecord[]>();
    for (const location of atlas.locations) {
      const key = location.region || '未分区';
      map.set(key, [...(map.get(key) ?? []), location]);
    }
    return Array.from(map.entries());
  }, [atlas.locations]);

  const commit = async (mutate: () => Atlas) => {
    try {
      const saveError = await onSave(mutate());
      setError(saveError);
      return !saveError;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.card}>
        <div className={styles.title}>
          <span>地点</span>
          <span className={styles.meta}>{atlas.locations.length} 处</span>
        </div>
        {atlas.locations.length === 0 && (
          <div className={styles.empty}>还没有地点，记录角色足迹可以避免地理设定前后矛盾</div>
        )}
        {groups.map(([groupName, locations]) => (
          <div key={groupName} className={styles.group}>
            <div className={styles.groupName}>{groupName}</div>
            {locations.map((location) => (
              <div key={location.id} className={styles.location} title={location.description ?? ''}>
                <div className={styles.locationHead}>
                  <span className={styles.locationName}>
                    {location.parent && <span className={styles.parent}>{location.parent} › </span>}
                    {location.name}
                  </span>
                  {location.firstChapter !== undefined && (
                    <span className={styles.first}>首见第 {location.firstChapter} 章</span>
                  )}
                  <button
                    type="button"
                    className={styles.remove}
                    disabled={busy}
                    aria-label={`删除地点 ${location.name}`}
                    onClick={() => void commit(() => removeLocation(atlas, location.id))}
                  >
                    ×
                  </button>
                </div>
                {location.description && (
                  <div className={styles.description}>{location.description}</div>
                )}
                {location.visits.length > 0 && (
                  <div className={styles.visits}>
                    {location.visits.map((visit, index) => (
                      <span
                        key={`${visit.character}-${index}`}
                        className={styles.chip}
                        title={visit.note ?? ''}
                      >
                        {visit.character}
                        {visit.chapter !== undefined ? ` · ${visit.chapter}` : ''}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      <form
        className={styles.card}
        onSubmit={(event) => {
          event.preventDefault();
          void commit(() =>
            recordVisit(atlas, visitLocation, visitCharacter, toChapter(visitChapter))
          ).then((ok) => ok && setVisitChapter(''));
        }}
      >
        <div className={styles.title}>
          <span>记录到访</span>
          <span className={styles.meta} title="地点不存在时会自动创建">
            ?
          </span>
        </div>
        <div className={styles.row}>
          <input
            className={styles.input}
            value={visitLocation}
            placeholder="地点"
            aria-label="到访地点"
            list="growth-map-locations"
            onChange={(event) => setVisitLocation(event.target.value)}
          />
          <input
            className={styles.input}
            value={visitCharacter}
            placeholder="角色"
            aria-label="到访角色"
            list="growth-map-characters"
            onChange={(event) => setVisitCharacter(event.target.value)}
          />
          <input
            className={`${styles.input} ${styles.small}`}
            value={visitChapter}
            placeholder="章"
            aria-label="到访章节"
            inputMode="numeric"
            onChange={(event) => setVisitChapter(event.target.value)}
          />
          <button
            type="submit"
            className={styles.primary}
            disabled={busy || !visitLocation.trim() || !visitCharacter.trim()}
          >
            记录
          </button>
        </div>
        <datalist id="growth-map-locations">
          {atlas.locations.map((location) => (
            <option key={location.id} value={location.name} />
          ))}
        </datalist>
        <datalist id="growth-map-characters">
          {characterNames.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
      </form>

      <form
        className={styles.card}
        onSubmit={(event) => {
          event.preventDefault();
          void commit(() =>
            addLocation(atlas, {
              name,
              region: region.trim() || undefined,
              parent: parent.trim() || undefined,
              description: description.trim() || undefined,
            })
          ).then((ok) => {
            if (ok) {
              setName('');
              setDescription('');
            }
          });
        }}
      >
        <div className={styles.title}>新增地点</div>
        <div className={styles.row}>
          <input
            className={styles.input}
            value={name}
            placeholder="地点名"
            aria-label="地点名"
            onChange={(event) => setName(event.target.value)}
          />
          <input
            className={styles.input}
            value={region}
            placeholder="区域"
            aria-label="区域"
            onChange={(event) => setRegion(event.target.value)}
          />
          <input
            className={styles.input}
            value={parent}
            placeholder="上级地点"
            aria-label="上级地点"
            list="growth-map-locations"
            onChange={(event) => setParent(event.target.value)}
          />
        </div>
        <div className={styles.row}>
          <input
            className={styles.input}
            value={description}
            placeholder="描述（气候、势力、地标…）"
            aria-label="地点描述"
            onChange={(event) => setDescription(event.target.value)}
          />
          <button type="submit" className={styles.primary} disabled={busy || !name.trim()}>
            添加
          </button>
        </div>
      </form>
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
    </div>
  );
};

export default GrowthMapPanel;
