/** A successful preparation stays locked until the main-process lease is released. */
export interface RendererPreparationRequest {
  requestId: string;
  reason: 'close' | 'export';
}
export interface RendererPreparationResult {
  requestId: string;
  success: boolean;
}
