// @vitest-environment node
import { expect, it } from 'vitest';
import {
  recoveryCapability,
  desktopQuote,
  validateRecoveryDescriptor,
} from '../../../src/main/auto-updater/recovery-supervisor';
it('makes privileged Debian recovery explicit instead of claiming unattended recovery', () => {
  expect(recoveryCapability('linux', false)).toEqual(
    expect.objectContaining({ mode: 'deb', authorization: 'system-prompt' })
  );
  expect(recoveryCapability('linux', true).authorization).toBe('none');
});
it('rejects arbitrary paths and protocol1-only fallback acknowledgements', () => {
  expect(validateRecoveryDescriptor({ id: '../escape', protocol: 1 })).toBe(false);
  expect(
    validateRecoveryDescriptor({
      id: 'a'.repeat(48),
      protocol: 1,
      target: '2.0.0',
      previous: '1.0.0',
    })
  ).toBe(true);
});
it('quotes filenames without shell substitution or desktop percent field expansion', () => {
  expect(desktopQuote('/tmp/100% "$a')).toBe('"/tmp/100%% \\"\\$a"');
});
