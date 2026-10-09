/** CDP keyboard regression using CodeMirror's real command/history dispatcher. */
import { EditorState, type Transaction, type TransactionSpec } from '@codemirror/state';
import { keymap, runScopeHandlers, type EditorView } from '@codemirror/view';
import { history, isolateHistory, redo, undo } from '@codemirror/commands';
import { describe, expect, it, vi } from 'vitest';
import { CdpClient, type CdpParams } from './support/cdp';
import { Page } from './support/page';

describe('CDP keyboard driver', () => {
  it('Ctrl+Shift+Z redoes rather than consuming an earlier undo entry', async () => {
    let state = EditorState.create({
      doc: 'base',
      extensions: [
        history(),
        keymap.of([
          { key: 'Ctrl-z', run: undo },
          { key: 'Ctrl-Shift-z', run: redo },
        ]),
      ],
    });
    // These commands only need state and dispatch; no DOM or Electron is involved.
    const view = {
      get state() {
        return state;
      },
      dispatch(transaction: Transaction | TransactionSpec) {
        state = 'state' in transaction ? transaction.state : state.update(transaction).state;
      },
    } as EditorView;
    view.dispatch({
      changes: { from: 4, insert: ' original' },
      annotations: isolateHistory.of('full'),
    });
    view.dispatch({
      changes: { from: 13, insert: ' added' },
      annotations: isolateHistory.of('full'),
    });
    expect(undo(view)).toBe(true);
    expect(state.doc.toString()).toBe('base original');

    const cdp = Object.create(CdpClient.prototype) as CdpClient;
    vi.spyOn(cdp, 'on').mockImplementation(() => () => {});
    vi.spyOn(cdp, 'send').mockImplementation(async (_method, params: CdpParams = {}) => {
      if (params.type !== 'rawKeyDown') return {};
      // Feed the transport's actual event fields to CodeMirror, including Shift.
      const bits = Number(params.modifiers);
      runScopeHandlers(
        view,
        {
          key: params.key,
          keyCode: params.windowsVirtualKeyCode,
          ctrlKey: Boolean(bits & 2),
          metaKey: Boolean(bits & 4),
          shiftKey: Boolean(bits & 8),
          altKey: Boolean(bits & 1),
        } as KeyboardEvent,
        'editor'
      );
      return {};
    });
    await new Page(cdp, '').press('z', ['Control', 'Shift']);
    expect(state.doc.toString()).toBe('base original added');
  });
});
