/**
 * CRDT 操作流通道类型定义（预留版）。
 *
 * 目标：将 "全文字符串同步" 与 "增量操作流" 分离。
 * 当前只定义协议，不绑定具体 CRDT 引擎（Yjs/Automerge/自研均可接入）。
 */

export type CrdtOpKind = 'insert' | 'delete' | 'replace' | 'cursor' | 'presence' | 'custom';

export interface CrdtOp {
  kind: CrdtOpKind;
  from?: number;
  to?: number;
  text?: string;
  actorId: string;
  timestamp: number;
  payload?: unknown;
}

export interface CrdtOpsEnvelope {
  docId: string;
  ops: CrdtOp[];
  seq: number;
}
