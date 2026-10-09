import { publishGeneratedSample } from './sample-generation.mts';
import { refreshSampleTree } from './generate-sample-data.mts';

/** Media generation and seed/hash refresh share one publication transaction. */
export async function publishSampleMedia(
  root: string,
  generateAssets: (stage: string) => Promise<void>,
  apply = false
): Promise<void> {
  await publishGeneratedSample(
    root,
    async (stage) => {
      await generateAssets(stage);
      await refreshSampleTree(stage);
    },
    apply
  );
}
