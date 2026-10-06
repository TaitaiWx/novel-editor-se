import React from 'react';
import type { GrowthSnapshot } from '../../../../types/growth-api';
import type { GrowthMemoryApi } from '../useGrowthMemory';
import { GrowthMapPanel } from '../GrowthMapPanel';
import { GrowthPartyPanel } from '../GrowthPartyPanel';
import { GrowthRulesPanel } from '../GrowthRulesPanel';
import { GROWTH_TIPS } from '../growthGuide';
import styles from './styles.module.scss';

export type GrowthWorldTab = 'party' | 'map' | 'rules';

const WORLD_TABS: Array<[GrowthWorldTab, string]> = [
  ['party', '队伍'],
  ['map', '地图'],
  ['rules', '规则'],
];

interface GrowthWorldProps {
  snapshot: GrowthSnapshot;
  growth: Pick<GrowthMemoryApi, 'busy' | 'saveParty' | 'saveAtlas' | 'saveRuleset'>;
  characterNames: string[];
  selectedCharacter: string | null;
  tab: GrowthWorldTab;
  onTabChange: (tab: GrowthWorldTab) => void;
}

/** 世界：所有角色共用的队伍、地图与规则 */
export const GrowthWorld: React.FC<GrowthWorldProps> = ({
  snapshot,
  growth,
  characterNames,
  selectedCharacter,
  tab,
  onTabChange,
}) => (
  <div className={styles.world}>
    <div className={styles.nav}>
      <div className={styles.tabs} role="tablist" aria-label="世界">
        {WORLD_TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={styles.tab}
            onClick={() => onTabChange(key)}
          >
            {label}
            {key === 'party' && snapshot.check.forgotten.length > 0 && (
              <span className={styles.badge}>{snapshot.check.forgotten.length}</span>
            )}
          </button>
        ))}
      </div>
      <span className={styles.desc}>{GROWTH_TIPS[tab]}</span>
    </div>
    {tab === 'party' && (
      <GrowthPartyPanel
        party={snapshot.party}
        forgotten={snapshot.check.forgotten}
        currentChapter={snapshot.check.currentChapter}
        forgottenAfter={snapshot.ruleset.limits.forgottenAfterChapters}
        characterNames={characterNames}
        busy={growth.busy}
        onSave={growth.saveParty}
      />
    )}
    {tab === 'map' && (
      <GrowthMapPanel
        atlas={snapshot.atlas}
        characterNames={characterNames}
        selectedCharacter={selectedCharacter}
        busy={growth.busy}
        onSave={growth.saveAtlas}
      />
    )}
    {tab === 'rules' && (
      <GrowthRulesPanel ruleset={snapshot.ruleset} busy={growth.busy} onSave={growth.saveRuleset} />
    )}
  </div>
);

export default GrowthWorld;
