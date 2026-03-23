import { useMessagePort } from './useMessagePort';
import { PortChannel } from '../../shared/portChannels';
import type { CrdtOpsEnvelope } from '../../shared/crdtOps';

/**
 * CRDT 操作流发送端 Hook（主窗口侧）。
 * 与正文字符串通道解耦，专用于增量操作广播。
 */
export function useCrdtOpsSender() {
  return useMessagePort<CrdtOpsEnvelope>(PortChannel.CrdtOps);
}

/**
 * CRDT 操作流接收端 Hook（故事面板侧）。
 *
 * 当前为预留扩展点：后续接入协同引擎时，在回调中应用 ops 即可。
 */
export function useCrdtOpsReceiver(onOps: (envelope: CrdtOpsEnvelope) => void) {
  return useMessagePort<CrdtOpsEnvelope>(PortChannel.CrdtOps, onOps);
}
