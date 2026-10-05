/**
 * UT globalSetup：每次运行前自动清理上一次的测试临时目录
 */
import { UT_ARTIFACT_DIRS, cleanTestArtifacts } from './vitest.shared';

export default function setup(): void {
  cleanTestArtifacts('ut', UT_ARTIFACT_DIRS);
}
