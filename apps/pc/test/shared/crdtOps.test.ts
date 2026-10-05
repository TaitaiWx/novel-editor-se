import { describe, expect, expectTypeOf, it } from 'vitest';
import type { CrdtOp, CrdtOpKind, CrdtOpsEnvelope } from '../../src/shared/crdtOps';

describe('crdtOps 协议类型', () => {
  it('CrdtOpKind 覆盖全部操作类型', () => {
    expectTypeOf<CrdtOpKind>().toEqualTypeOf<
      'insert' | 'delete' | 'replace' | 'cursor' | 'presence' | 'custom'
    >();
  });

  it('envelope 可通过 structured clone / JSON 往返而不丢字段', () => {
    const op: CrdtOp = {
      kind: 'insert',
      from: 0,
      to: 0,
      text: '第一幕',
      actorId: 'actor-1',
      timestamp: 1700000000000,
      payload: { nested: [1, 2] },
    };
    const envelope: CrdtOpsEnvelope = { docId: 'doc-1', ops: [op], seq: 3 };

    expect(structuredClone(envelope)).toEqual(envelope);
    expect(JSON.parse(JSON.stringify(envelope)) as CrdtOpsEnvelope).toEqual(envelope);
  });

  it('可选字段可以省略', () => {
    const op: CrdtOp = { kind: 'cursor', actorId: 'a', timestamp: 0 };
    expectTypeOf(op.from).toEqualTypeOf<number | undefined>();
    expect(op.text).toBeUndefined();
  });
});
