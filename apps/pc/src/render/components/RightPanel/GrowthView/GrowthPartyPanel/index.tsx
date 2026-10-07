import React, { useState } from 'react';
import {
  addParty,
  endParty,
  markCompanionSeen,
  removeParty,
  type ForgottenCompanion,
  type PartyBook,
} from '@novel-editor/core/growth';
import styles from './styles.module.scss';

interface GrowthPartyPanelProps {
  party: PartyBook;
  forgotten: ForgottenCompanion[];
  currentChapter: number;
  forgottenAfter: number;
  characterNames: string[];
  busy: boolean;
  onSave: (party: PartyBook) => Promise<string | null>;
}

function toChapter(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const num = Number(value);
  return Number.isInteger(num) && num >= 0 ? num : undefined;
}

/**
 * 队伍历史（曾经组过的队伍）+ 配角出场提醒
 */
export const GrowthPartyPanel: React.FC<GrowthPartyPanelProps> = ({
  party,
  forgotten,
  currentChapter,
  forgottenAfter,
  characterNames,
  busy,
  onSave,
}) => {
  const [name, setName] = useState('');
  const [members, setMembers] = useState('');
  const [from, setFrom] = useState('');
  const [seenName, setSeenName] = useState('');
  const [seenChapter, setSeenChapter] = useState(currentChapter ? String(currentChapter) : '');
  const [endChapter, setEndChapter] = useState(currentChapter ? String(currentChapter) : '');
  const [error, setError] = useState<string | null>(null);

  /** 执行纯函数修改并保存；core 抛出的校验错误直接展示 */
  const commit = async (mutate: () => PartyBook) => {
    try {
      const next = mutate();
      const saveError = await onSave(next);
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
          <span>被遗忘的配角</span>
          <span
            className={styles.meta}
            title={`超过 ${forgottenAfter} 章未出场的配角会出现在这里（可在规则中调整）`}
          >
            当前第 {currentChapter} 章
          </span>
        </div>
        {forgotten.length === 0 ? (
          <div className={styles.ok}>配角们都还在读者视线里</div>
        ) : (
          forgotten.map((item) => (
            <div key={item.name} className={styles.forgotten}>
              <span className={styles.forgottenName}>
                {item.important && <span title="重点配角">★ </span>}
                {item.name}
              </span>
              <span className={styles.forgottenMeta}>
                第 {item.lastSeenChapter} 章后已 {item.chaptersAbsent} 章未出场
                {item.parties.length > 0 ? ` · 曾在 ${item.parties.join('、')}` : ''}
              </span>
              <button
                type="button"
                className={styles.button}
                disabled={busy}
                title="标记在当前章节出场"
                onClick={() =>
                  void commit(() => markCompanionSeen(party, item.name, currentChapter))
                }
              >
                已出场
              </button>
            </div>
          ))
        )}
      </div>

      <div className={styles.card}>
        <div className={styles.title}>
          <span>组队历史</span>
          <span className={styles.meta}>{party.parties.length} 支队伍</span>
        </div>
        {party.parties.length === 0 && <div className={styles.empty}>还没有队伍记录</div>}
        {party.parties.map((item) => (
          <div key={item.id} className={styles.party}>
            <div className={styles.partyHead}>
              <span className={styles.partyName}>{item.name}</span>
              <span className={styles.partyRange}>
                第 {item.fromChapter ?? '?'} ~ {item.toChapter ?? '至今'} 章
              </span>
            </div>
            <div className={styles.members}>
              {item.members.map((member) => (
                <span key={member} className={styles.chip}>
                  {member}
                </span>
              ))}
            </div>
            {item.notes && <div className={styles.notes}>{item.notes}</div>}
            <div className={styles.partyActions}>
              {item.toChapter === undefined && (
                <button
                  type="button"
                  className={styles.button}
                  disabled={busy || toChapter(endChapter) === undefined}
                  title="在下方「解散章节」填写的章节解散"
                  onClick={() =>
                    void commit(() => endParty(party, item.id, toChapter(endChapter) ?? 0))
                  }
                >
                  解散
                </button>
              )}
              <button
                type="button"
                className={styles.button}
                disabled={busy}
                onClick={() => void commit(() => removeParty(party, item.id))}
              >
                删除
              </button>
            </div>
          </div>
        ))}
        <div className={styles.inlineField}>
          <span>解散章节</span>
          <input
            className={`${styles.input} ${styles.small}`}
            value={endChapter}
            inputMode="numeric"
            onChange={(event) => setEndChapter(event.target.value)}
          />
        </div>
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void commit(() =>
              addParty(party, {
                name,
                members: members.split(/[,\uff0c\u3001\s]+/),
                fromChapter: toChapter(from),
              })
            ).then((ok) => {
              if (ok) {
                setName('');
                setMembers('');
              }
            });
          }}
        >
          <div className={styles.row}>
            <input
              className={styles.input}
              value={name}
              placeholder="队伍名"
              aria-label="队伍名"
              onChange={(event) => setName(event.target.value)}
            />
            <input
              className={`${styles.input} ${styles.small}`}
              value={from}
              placeholder="组队章"
              aria-label="组队章节"
              inputMode="numeric"
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>
          <div className={styles.row}>
            <input
              className={styles.input}
              value={members}
              placeholder="成员，用逗号分隔"
              aria-label="成员"
              list="growth-party-members"
              onChange={(event) => setMembers(event.target.value)}
            />
            <button type="submit" className={styles.primary} disabled={busy || !name.trim()}>
              新建队伍
            </button>
          </div>
          <datalist id="growth-party-members">
            {characterNames.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
        </form>
      </div>

      <div className={styles.card}>
        <div className={styles.title}>
          <span>配角出场</span>
          <span className={styles.meta}>{party.companions.length} 人</span>
        </div>
        {party.companions.map((item) => (
          <div key={item.name} className={styles.companion}>
            <span className={styles.companionName}>{item.name}</span>
            <span className={styles.companionSeen}>
              {item.lastSeenChapter !== undefined ? `最近第 ${item.lastSeenChapter} 章` : '未记录'}
            </span>
            <button
              type="button"
              className={`${styles.star} ${item.important ? styles.starOn : ''}`}
              disabled={busy}
              title={item.important ? '取消重点配角' : '标记为重点配角（读者喜爱，优先提醒）'}
              onClick={() =>
                void commit(() =>
                  markCompanionSeen(party, item.name, undefined, { important: !item.important })
                )
              }
            >
              ★
            </button>
          </div>
        ))}
        <form
          className={styles.row}
          onSubmit={(event) => {
            event.preventDefault();
            void commit(() => markCompanionSeen(party, seenName, toChapter(seenChapter))).then(
              (ok) => ok && setSeenName('')
            );
          }}
        >
          <input
            className={styles.input}
            value={seenName}
            placeholder="配角名"
            aria-label="配角名"
            list="growth-party-members"
            onChange={(event) => setSeenName(event.target.value)}
          />
          <input
            className={`${styles.input} ${styles.small}`}
            value={seenChapter}
            placeholder="章"
            aria-label="出场章节"
            inputMode="numeric"
            onChange={(event) => setSeenChapter(event.target.value)}
          />
          <button type="submit" className={styles.button} disabled={busy || !seenName.trim()}>
            记录出场
          </button>
        </form>
      </div>
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
    </div>
  );
};

export default GrowthPartyPanel;
